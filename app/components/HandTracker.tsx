'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Matter from 'matter-js';

// TypeScript declarations for MediaPipe libraries
declare global {
  interface Window {
    Hands: any;
    drawConnectors: any;
    drawLandmarks: any;
    HAND_CONNECTIONS: any;
    Camera: any;
  }
}

// Constants
const BOX_COLORS = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F'];
const MAX_BOXES = 20;
const MAX_WATER_PARTICLES = 500;

// Material types
type MaterialType = 'solid' | 'water';

// Interaction modes
type InteractionMode = 'drawing' | 'physics';

// Water configuration - using metaball/liquid rendering approach with Gaussian blur
const WATER_PARTICLE_RADIUS = 12;
const WATER_PARTICLE_SPACING = 20;
const WATER_COLOR = 'rgba(77, 157, 224, 1)'; // Solid color for filter effect
const WATER_BLUR_AMOUNT = 12; // Gaussian blur stdDeviation
const WATER_CONTRAST = 20; // Color matrix alpha multiplier
const WATER_THRESHOLD = -10; // Color matrix alpha offset

export default function HandTracker() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const physicsCanvasRef = useRef<HTMLCanvasElement>(null);
  const waterCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [handsDetected, setHandsDetected] = useState(0);
  const [isPinching, setIsPinching] = useState(false);
  const [isGrabbing, setIsGrabbing] = useState(false);
  const [isAntigravity, setIsAntigravity] = useState(false);
  const [currentMaterial, setCurrentMaterial] = useState<MaterialType>('solid');
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('drawing');
  const [particleCount, setParticleCount] = useState(0);

  // Matter.js refs
  const engineRef = useRef<Matter.Engine | null>(null);
  const renderRef = useRef<Matter.Render | null>(null);
  const runnerRef = useRef<Matter.Runner | null>(null);
  const boxesRef = useRef<Matter.Body[]>([]);
  const waterParticlesRef = useRef<Matter.Body[]>([]);
  const groundRef = useRef<Matter.Body | null>(null);
  const wallsRef = useRef<Matter.Body[]>([]);
  const waterAnimationRef = useRef<number | null>(null);

  // Gesture tracking refs
  const pinchStartRef = useRef<{ x: number; y: number } | null>(null);
  const pinchCurrentRef = useRef<{ x: number; y: number } | null>(null);
  const currentMaterialRef = useRef<MaterialType>('solid');
  const interactionModeRef = useRef<InteractionMode>('drawing');

  // Throwing/grabbing refs
  const grabbedBoxRef = useRef<Matter.Body | null>(null);
  const previousGrabPosRef = useRef<{ x: number; y: number } | null>(null);
  const grabVelocityRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Helper function to calculate Euclidean distance
  const calculateDistance = (point1: { x: number; y: number }, point2: { x: number; y: number }) => {
    return Math.sqrt(Math.pow(point2.x - point1.x, 2) + Math.pow(point2.y - point1.y, 2));
  };

  // Detect pinch gesture and return state and position
  const detectPinchGesture = (landmarks: any) => {
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];

    const distance = calculateDistance(
      { x: thumbTip.x, y: thumbTip.y },
      { x: indexTip.x, y: indexTip.y }
    );

    const isPinchActive = distance < 0.05;
    const position = {
      x: indexTip.x * 1280,
      y: indexTip.y * 720
    };

    return { isPinchActive, position };
  };

  // Detect pointing up gesture (index finger pointing upward)
  const detectPointingUpGesture = (landmarks: any) => {
    const indexTip = landmarks[8];
    const indexMcp = landmarks[5]; // Base of index finger
    const middleTip = landmarks[12];
    const middleMcp = landmarks[9];
    const ringTip = landmarks[16];
    const ringMcp = landmarks[13];
    const pinkyTip = landmarks[20];
    const pinkyMcp = landmarks[17];
    const wrist = landmarks[0];

    // Check if index finger is extended upward (tip higher than base and wrist)
    const indexExtended = indexTip.y < indexMcp.y - 0.08 && indexTip.y < wrist.y - 0.1;

    // Check if other fingers are curled
    const middleCurled = middleTip.y > middleMcp.y - 0.03;
    const ringCurled = ringTip.y > ringMcp.y - 0.03;
    const pinkyCurled = pinkyTip.y > pinkyMcp.y - 0.03;

    return indexExtended && middleCurled && ringCurled && pinkyCurled;
  };

  // Detect palm down gesture (hand facing downward)
  const detectPalmDownGesture = (landmarks: any) => {
    const indexTip = landmarks[8];
    const middleTip = landmarks[12];
    const ringTip = landmarks[16];
    const pinkyTip = landmarks[20];
    const wrist = landmarks[0];
    const indexMcp = landmarks[5];
    const middleMcp = landmarks[9];

    // Check if fingertips are below their bases (pointing downward)
    const indexDown = indexTip.y > indexMcp.y + 0.03;
    const middleDown = middleTip.y > middleMcp.y + 0.03;

    // Check if fingertips are generally below wrist (hand facing down)
    const tipsBelow = indexTip.y > wrist.y && middleTip.y > wrist.y;

    return (indexDown || middleDown) && tipsBelow;
  };

  // Find the closest box to a position
  const findClosestBox = (position: { x: number; y: number }, maxDistance: number = 100) => {
    let closestBox: Matter.Body | null = null;
    let minDistance = maxDistance;

    boxesRef.current.forEach(box => {
      const dx = box.position.x - position.x;
      const dy = box.position.y - position.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < minDistance) {
        minDistance = distance;
        closestBox = box;
      }
    });

    return closestBox;
  };

  // Initialize Matter.js physics engine
  const initializeMatterJS = () => {
    const physicsCanvas = physicsCanvasRef.current;
    if (!physicsCanvas) return;

    // Create engine
    const engine = Matter.Engine.create();
    engine.gravity.y = 0.5;
    engineRef.current = engine;

    // Create renderer
    const render = Matter.Render.create({
      canvas: physicsCanvas,
      engine: engine,
      options: {
        width: 1280,
        height: 720,
        wireframes: false,
        background: 'transparent'
      }
    });
    renderRef.current = render;

    // Create ground
    const ground = Matter.Bodies.rectangle(640, 710, 1280, 20, {
      isStatic: true,
      render: { fillStyle: '#444444' }
    });
    groundRef.current = ground;

    // Create walls
    const leftWall = Matter.Bodies.rectangle(0, 360, 20, 720, {
      isStatic: true,
      render: { fillStyle: '#444444' }
    });
    const rightWall = Matter.Bodies.rectangle(1280, 360, 20, 720, {
      isStatic: true,
      render: { fillStyle: '#444444' }
    });
    wallsRef.current = [leftWall, rightWall];

    // Add static bodies to world
    Matter.World.add(engine.world, [ground, leftWall, rightWall]);

    // Start renderer and runner
    Matter.Render.run(render);
    const runner = Matter.Runner.create();
    runnerRef.current = runner;
    Matter.Runner.run(runner, engine);
  };

  // Create a physics box or water based on material type
  const createBox = (start: { x: number; y: number }, end: { x: number; y: number }) => {
    if (currentMaterialRef.current === 'water') {
      createWater(start, end);
    } else {
      createSolidBox(start, end);
    }
  };

  // Create a solid physics box
  const createSolidBox = (start: { x: number; y: number }, end: { x: number; y: number }) => {
    if (!engineRef.current) return;

    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);

    // Minimum size validation
    if (width < 20 || height < 20) return;

    const centerX = (start.x + end.x) / 2;
    const centerY = (start.y + end.y) / 2;

    // Random color
    const color = BOX_COLORS[Math.floor(Math.random() * BOX_COLORS.length)];

    // Create Matter.js body
    const box = Matter.Bodies.rectangle(centerX, centerY, width, height, {
      restitution: 0.6,
      friction: 0.1,
      render: { fillStyle: color }
    });

    // Add to world
    Matter.World.add(engineRef.current.world, box);
    boxesRef.current.push(box);

    // FIFO removal if exceeding max boxes
    if (boxesRef.current.length > MAX_BOXES) {
      const oldestBox = boxesRef.current.shift();
      if (oldestBox && engineRef.current) {
        Matter.World.remove(engineRef.current.world, oldestBox);
      }
    }
  };

  // Create liquid water particles (no constraints - true fluid behavior with Gaussian blur)
  const createWater = (start: { x: number; y: number }, end: { x: number; y: number }) => {
    if (!engineRef.current) return;

    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);

    // Minimum size validation
    if (width < 30 || height < 30) return;

    const minX = Math.min(start.x, end.x);
    const minY = Math.min(start.y, end.y);

    // Calculate grid dimensions
    const cols = Math.max(2, Math.floor(width / WATER_PARTICLE_SPACING));
    const rows = Math.max(2, Math.floor(height / WATER_PARTICLE_SPACING));

    // Check if we would exceed max particles
    const newParticleCount = cols * rows;
    if (waterParticlesRef.current.length + newParticleCount > MAX_WATER_PARTICLES) {
      // Remove oldest particles to make room
      const toRemove = Math.min(
        waterParticlesRef.current.length,
        (waterParticlesRef.current.length + newParticleCount) - MAX_WATER_PARTICLES
      );
      for (let i = 0; i < toRemove; i++) {
        const oldParticle = waterParticlesRef.current.shift();
        if (oldParticle && engineRef.current) {
          Matter.World.remove(engineRef.current.world, oldParticle);
        }
      }
    }

    // Create particles in a grid with slight randomness for natural look
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = minX + WATER_PARTICLE_SPACING * col + WATER_PARTICLE_SPACING / 2;
        const y = minY + WATER_PARTICLE_SPACING * row + WATER_PARTICLE_SPACING / 2;

        // Add slight randomness to initial position
        const randomX = x + (Math.random() - 0.5) * 4;
        const randomY = y + (Math.random() - 0.5) * 4;

        const particle = Matter.Bodies.circle(randomX, randomY, WATER_PARTICLE_RADIUS, {
          restitution: 0.3,
          friction: 0.0,
          frictionAir: 0.01,
          frictionStatic: 0,
          density: 0.001,
          slop: 0.5,
          label: 'water',
          render: {
            visible: false // We render water separately with blur effect
          }
        });

        Matter.World.add(engineRef.current.world, particle);
        waterParticlesRef.current.push(particle);
      }
    }

    setParticleCount(waterParticlesRef.current.length);
  };

  // Render water particles with Gaussian blur effect (metaball technique)
  const renderWater = useCallback(() => {
    const waterCanvas = waterCanvasRef.current;
    if (!waterCanvas) return;

    const ctx = waterCanvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, waterCanvas.width, waterCanvas.height);

    // Draw each water particle as a circle
    ctx.fillStyle = WATER_COLOR;

    for (const particle of waterParticlesRef.current) {
      const { x, y } = particle.position;
      const radius = WATER_PARTICLE_RADIUS * 1.8; // Slightly larger for better blending

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Schedule next frame
    waterAnimationRef.current = requestAnimationFrame(renderWater);
  }, []);

  // Clear all boxes and water particles
  const clearAllBoxes = () => {
    if (!engineRef.current) return;

    boxesRef.current.forEach(box => {
      Matter.World.remove(engineRef.current!.world, box);
    });
    boxesRef.current = [];

    waterParticlesRef.current.forEach(particle => {
      Matter.World.remove(engineRef.current!.world, particle);
    });
    waterParticlesRef.current = [];
    setParticleCount(0);
  };

  useEffect(() => {
    let camera: any = null;
    let hands: any = null;

    const initializeHandTracking = async () => {
      try {
        const video = videoRef.current;
        const canvas = canvasRef.current;

        if (!video || !canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Wait for MediaPipe scripts to load
        await loadMediaPipeScripts();

        // Initialize Hands model
        hands = new window.Hands({
          locateFile: (file: string) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/${file}`;
          }
        });

        hands.setOptions({
          selfieMode: true,
          maxNumHands: 2,
          modelComplexity: 1,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5
        });

        // Set up results callback
        hands.onResults((results: any) => {
          // Clear canvas
          ctx.save();
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          // Draw the video frame
          ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

          // Draw hand landmarks if detected
          if (results.multiHandLandmarks && results.multiHandedness) {
            setHandsDetected(results.multiHandLandmarks.length);

            for (let i = 0; i < results.multiHandLandmarks.length; i++) {
              const landmarks = results.multiHandLandmarks[i];
              const handedness = results.multiHandedness[i];
              const isRightHand = handedness.label === 'Right';

              // Draw connections (hand skeleton)
              window.drawConnectors(
                ctx,
                landmarks,
                window.HAND_CONNECTIONS,
                { color: isRightHand ? '#00FF00' : '#FF0000', lineWidth: 2 }
              );

              // Draw landmarks (joint points)
              window.drawLandmarks(
                ctx,
                landmarks,
                {
                  color: isRightHand ? '#00FF00' : '#FF0000',
                  fillColor: isRightHand ? '#FF0000' : '#00FF00',
                  lineWidth: 1,
                  radius: 3
                }
              );

              // Gesture detection for first hand
              if (i === 0) {
                const { isPinchActive, position: pinchPosition } = detectPinchGesture(landmarks);

                // DRAWING MODE: Use pinch for drawing
                if (interactionModeRef.current === 'drawing') {
                  if (isPinchActive) {
                    if (!pinchStartRef.current) {
                      // Start of pinch
                      pinchStartRef.current = pinchPosition;
                      setIsPinching(true);
                    }
                    // Update current position while pinching
                    pinchCurrentRef.current = pinchPosition;

                    // Draw preview outline
                    if (pinchStartRef.current && pinchCurrentRef.current) {
                      ctx.strokeStyle = currentMaterialRef.current === 'water' ? '#4D9DE0' : '#FFFFFF';
                      ctx.lineWidth = 2;
                      ctx.setLineDash([5, 5]);
                      const width = pinchCurrentRef.current.x - pinchStartRef.current.x;
                      const height = pinchCurrentRef.current.y - pinchStartRef.current.y;
                      ctx.strokeRect(
                        pinchStartRef.current.x,
                        pinchStartRef.current.y,
                        width,
                        height
                      );
                      ctx.setLineDash([]);
                    }
                  } else {
                    // Release pinch
                    if (pinchStartRef.current && pinchCurrentRef.current) {
                      createBox(pinchStartRef.current, pinchCurrentRef.current);
                    }
                    pinchStartRef.current = null;
                    pinchCurrentRef.current = null;
                    setIsPinching(false);
                  }
                }

                // PHYSICS MODE: Use pinch for grabbing/throwing
                if (interactionModeRef.current === 'physics') {
                  if (isPinchActive) {
                    // Try to grab a box if not already holding one
                    if (!grabbedBoxRef.current) {
                      const closestBox = findClosestBox(pinchPosition, 80);
                      if (closestBox) {
                        grabbedBoxRef.current = closestBox;
                        Matter.Body.setStatic(closestBox, true);
                        previousGrabPosRef.current = pinchPosition;
                        setIsGrabbing(true);
                      }
                    } else {
                      // Move the grabbed box
                      const box = grabbedBoxRef.current;
                      Matter.Body.setPosition(box, { x: pinchPosition.x, y: pinchPosition.y });

                      // Calculate velocity for throwing
                      if (previousGrabPosRef.current) {
                        grabVelocityRef.current = {
                          x: (pinchPosition.x - previousGrabPosRef.current.x) * 0.5,
                          y: (pinchPosition.y - previousGrabPosRef.current.y) * 0.5
                        };
                      }
                      previousGrabPosRef.current = pinchPosition;

                      // Draw visual indicator for grabbed box
                      ctx.strokeStyle = '#FFFF00';
                      ctx.lineWidth = 3;
                      ctx.beginPath();
                      ctx.arc(pinchPosition.x, pinchPosition.y, 50, 0, Math.PI * 2);
                      ctx.stroke();
                    }
                  } else {
                    // Release pinch - throw the box
                    if (grabbedBoxRef.current) {
                      Matter.Body.setStatic(grabbedBoxRef.current, false);
                      Matter.Body.setVelocity(grabbedBoxRef.current, {
                        x: grabVelocityRef.current.x,
                        y: grabVelocityRef.current.y
                      });
                      grabbedBoxRef.current = null;
                      previousGrabPosRef.current = null;
                      grabVelocityRef.current = { x: 0, y: 0 };
                      setIsGrabbing(false);
                    }
                  }
                }
              }

            }

            // Check for antigravity gesture (requires BOTH hands)
            let rightHandPointingUp = false;
            let leftHandPalmDown = false;

            if (results.multiHandLandmarks && results.multiHandedness) {
              for (let i = 0; i < results.multiHandLandmarks.length; i++) {
                const landmarks = results.multiHandLandmarks[i];
                const handedness = results.multiHandedness[i];
                const isRightHand = handedness.label === 'Right';

                if (isRightHand && detectPointingUpGesture(landmarks)) {
                  rightHandPointingUp = true;
                }
                if (!isRightHand && detectPalmDownGesture(landmarks)) {
                  leftHandPalmDown = true;
                }
              }
            }

            // Activate antigravity only if BOTH gestures are active
            if (rightHandPointingUp && leftHandPalmDown) {
              setIsAntigravity(true);
              // Set negative gravity (antigravity)
              if (engineRef.current) {
                engineRef.current.gravity.y = -0.5;
              }

              // Draw antigravity visual effect
              ctx.save();
              ctx.globalAlpha = 0.3;
              ctx.fillStyle = '#9333EA'; // purple overlay
              ctx.fillRect(0, 0, canvas.width, canvas.height);

              // Draw upward arrows
              ctx.globalAlpha = 0.7;
              ctx.strokeStyle = '#C084FC';
              ctx.lineWidth = 4;
              ctx.lineCap = 'round';
              for (let x = 100; x < canvas.width; x += 150) {
                for (let y = 100; y < canvas.height; y += 150) {
                  // Draw upward arrow
                  ctx.beginPath();
                  ctx.moveTo(x, y + 20);
                  ctx.lineTo(x, y - 20);
                  ctx.lineTo(x - 10, y - 10);
                  ctx.moveTo(x, y - 20);
                  ctx.lineTo(x + 10, y - 10);
                  ctx.stroke();
                }
              }
              ctx.restore();
            } else {
              // Reset gravity if gestures are not both active
              setIsAntigravity(false);
              if (engineRef.current) {
                engineRef.current.gravity.y = 0.5;
              }
            }
          } else {
            setHandsDetected(0);
            // Reset pinch state if no hands detected
            pinchStartRef.current = null;
            pinchCurrentRef.current = null;
            setIsPinching(false);

            // Release grabbed box if no hands detected
            if (grabbedBoxRef.current) {
              Matter.Body.setStatic(grabbedBoxRef.current, false);
              grabbedBoxRef.current = null;
              previousGrabPosRef.current = null;
              grabVelocityRef.current = { x: 0, y: 0 };
              setIsGrabbing(false);
            }

            // Reset gravity if no hands detected
            setIsAntigravity(false);
            if (engineRef.current) {
              engineRef.current.gravity.y = 0.5;
            }
          }

          ctx.restore();
        });

        // Initialize camera
        camera = new window.Camera(video, {
          onFrame: async () => {
            if (video && hands) {
              await hands.send({ image: video });
            }
          },
          width: 1280,
          height: 720
        });

        await camera.start();

        // Initialize Matter.js physics
        initializeMatterJS();

        // Start water rendering loop
        renderWater();

        setIsLoading(false);

      } catch (err) {
        console.error('Error initializing hand tracking:', err);
        setError('Failed to initialize hand tracking. Please ensure camera permissions are granted.');
        setIsLoading(false);
      }
    };

    initializeHandTracking();

    // Cleanup
    return () => {
      if (camera) {
        camera.stop();
      }
      if (hands) {
        hands.close();
      }
      if (waterAnimationRef.current) {
        cancelAnimationFrame(waterAnimationRef.current);
      }
      if (runnerRef.current && engineRef.current) {
        Matter.Runner.stop(runnerRef.current);
      }
      if (renderRef.current) {
        Matter.Render.stop(renderRef.current);
      }
      if (engineRef.current) {
        Matter.Engine.clear(engineRef.current);
      }
    };
  }, [renderWater]);

  // Function to load MediaPipe scripts dynamically
  const loadMediaPipeScripts = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      // Check if scripts are already loaded
      if (
        window.Hands &&
        window.drawConnectors &&
        window.drawLandmarks &&
        window.HAND_CONNECTIONS &&
        window.Camera
      ) {
        resolve();
        return;
      }

      const scripts = [
        'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@0.3/camera_utils.js',
        'https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils@0.3/drawing_utils.js',
        'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/hands.js'
      ];

      let loadedCount = 0;

      scripts.forEach((src) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => {
          loadedCount++;
          if (loadedCount === scripts.length) {
            // Wait a bit for globals to be available
            setTimeout(() => resolve(), 100);
          }
        };
        script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
        document.head.appendChild(script);
      });
    });
  };

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center bg-black">
      {/* SVG Filter for liquid/metaball effect */}
      <svg style={{ position: 'absolute', width: 0, height: 0 }}>
        <defs>
          <filter id="liquid-filter">
            {/* Gaussian blur to blend particles */}
            <feGaussianBlur in="SourceGraphic" stdDeviation={WATER_BLUR_AMOUNT} result="blur" />
            {/* Color matrix to increase contrast and create sharp edges */}
            {/* The alpha channel is multiplied by WATER_CONTRAST and offset by WATER_THRESHOLD */}
            <feColorMatrix
              in="blur"
              mode="matrix"
              values={`1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${WATER_CONTRAST} ${WATER_THRESHOLD}`}
              result="contrast"
            />
          </filter>
        </defs>
      </svg>

      {/* Status bar */}
      <div className="absolute top-4 left-4 z-10 bg-black/70 text-white px-4 py-2 rounded-lg">
        {isLoading ? (
          <span>Loading hand tracking...</span>
        ) : error ? (
          <span className="text-red-400">{error}</span>
        ) : (
          <div className="flex items-center gap-4">
            <span>
              {handsDetected === 0 ? 'No hands detected' : `${handsDetected} hand${handsDetected > 1 ? 's' : ''} detected`}
            </span>
            {isPinching && <span>Drawing</span>}
            {isGrabbing && <span>Grabbing</span>}
            {isAntigravity && <span className="text-purple-400 font-bold">Antigravity</span>}
            <span>Boxes: {boxesRef.current.length}/{MAX_BOXES}</span>
            <span>Water: {particleCount}/{MAX_WATER_PARTICLES}</span>
          </div>
        )}
      </div>

      {/* Mode and Material selectors */}
      <div className="absolute top-4 right-4 z-10 bg-black/70 text-white px-4 py-2 rounded-lg space-y-2">
        {/* Mode selector */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Mode:</span>
          <button
            onClick={() => {
              setInteractionMode('drawing');
              interactionModeRef.current = 'drawing';
              // Release any grabbed box when switching modes
              if (grabbedBoxRef.current) {
                Matter.Body.setStatic(grabbedBoxRef.current, false);
                grabbedBoxRef.current = null;
                setIsGrabbing(false);
              }
            }}
            className={`px-3 py-1 rounded text-sm font-semibold transition-colors ${
              interactionMode === 'drawing'
                ? 'bg-green-600 hover:bg-green-700'
                : 'bg-gray-600 hover:bg-gray-700'
            }`}
          >
            Drawing
          </button>
          <button
            onClick={() => {
              setInteractionMode('physics');
              interactionModeRef.current = 'physics';
              // Reset drawing state when switching modes
              pinchStartRef.current = null;
              pinchCurrentRef.current = null;
              setIsPinching(false);
            }}
            className={`px-3 py-1 rounded text-sm font-semibold transition-colors ${
              interactionMode === 'physics'
                ? 'bg-green-600 hover:bg-green-700'
                : 'bg-gray-600 hover:bg-gray-700'
            }`}
          >
            Physics
          </button>
        </div>

        {/* Material selector - only show in drawing mode */}
        {interactionMode === 'drawing' && (
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Material:</span>
            <button
              onClick={() => {
                setCurrentMaterial('solid');
                currentMaterialRef.current = 'solid';
              }}
              className={`px-3 py-1 rounded text-sm font-semibold transition-colors ${
                currentMaterial === 'solid'
                  ? 'bg-blue-600 hover:bg-blue-700'
                  : 'bg-gray-600 hover:bg-gray-700'
              }`}
            >
              Solid
            </button>
            <button
              onClick={() => {
                setCurrentMaterial('water');
                currentMaterialRef.current = 'water';
              }}
              className={`px-3 py-1 rounded text-sm font-semibold transition-colors ${
                currentMaterial === 'water'
                  ? 'bg-blue-600 hover:bg-blue-700'
                  : 'bg-gray-600 hover:bg-gray-700'
              }`}
            >
              Water
            </button>
          </div>
        )}
      </div>

      {/* Loading spinner */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20">
          <div className="w-16 h-16 border-4 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      )}

      {/* Hidden video element for camera input */}
      <video
        ref={videoRef}
        className="hidden"
        playsInline
      />

      {/* Canvas for rendering output */}
      <canvas
        ref={canvasRef}
        className="max-w-full max-h-full"
        width={1280}
        height={720}
      />

      {/* Water canvas with liquid filter (rendered below physics) */}
      <canvas
        ref={waterCanvasRef}
        className="absolute max-w-full max-h-full pointer-events-none"
        width={1280}
        height={720}
        style={{
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          filter: 'url(#liquid-filter)',
          zIndex: 1
        }}
      />

      {/* Physics canvas (transparent overlay for solid objects) */}
      <canvas
        ref={physicsCanvasRef}
        className="absolute max-w-full max-h-full pointer-events-none"
        width={1280}
        height={720}
        style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 2 }}
      />

      {/* Info panel */}
      <div className="absolute bottom-4 right-4 max-w-sm bg-black/70 text-white p-4 rounded-lg text-sm">
        <div className="flex justify-between items-start mb-2">
          <p className="font-semibold">Hand Tracking Info:</p>
          <button
            onClick={clearAllBoxes}
            className="bg-red-600 hover:bg-red-700 px-3 py-1 rounded text-xs font-semibold transition-colors"
          >
            Clear All ({boxesRef.current.length + particleCount})
          </button>
        </div>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>Green = Right hand, Red = Left hand</li>
          <li><strong>Drawing Mode:</strong> Pinch thumb and index together, drag to define area, release to create {currentMaterial === 'solid' ? 'solid boxes' : 'water'}</li>
          <li><strong>Physics Mode:</strong> Pinch near a box to grab it, move to reposition, release pinch to throw</li>
          <li><strong>Antigravity:</strong> Right hand points up + Left hand faces down (both required) to reverse gravity</li>
          <li><strong>Solid material:</strong> Creates rigid boxes that bounce and collide</li>
          <li><strong>Water material:</strong> Creates liquid particles with Gaussian blur effect (metaball technique)</li>
          <li>Switch modes and materials using buttons in top-right corner</li>
        </ul>
      </div>
    </div>
  );
}
