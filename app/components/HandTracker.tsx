'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Matter from 'matter-js';
import * as THREE from 'three';
import { detectKnucklesTogetherGesture, HandLandmark, Landmark } from '../utils/gestureDetection';

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
const WOOD_TEXTURE_PATH = '/assets/1454771477.svg';
const WOOD_TEXTURE_SIZE = 600;

// Material types
type MaterialType = 'solid' | 'water' | 'fire';
type SolidStyle = 'color' | 'wood';

// Interaction modes
type InteractionMode = 'drawing' | 'physics';

// Pending drawing (visual-only in drawing mode, converted to physics when switching to physics mode)
type PendingDrawing = {
  start: { x: number; y: number };
  end: { x: number; y: number };
  material: MaterialType;
  solidStyle: SolidStyle;
};

// Water configuration - using metaball/liquid rendering approach with Gaussian blur
const WATER_PARTICLE_RADIUS = 12;
const WATER_PARTICLE_SPACING = 20;
const WATER_COLOR = 'rgba(77, 157, 224, 0.6)';
const WATER_BLUR_AMOUNT = 12; // Gaussian blur stdDeviation
const WATER_CONTRAST = 20; // Color matrix alpha multiplier
const WATER_THRESHOLD = -10; // Color matrix alpha offset

// Fire configuration - Realistic fire rendering with blackbody radiation colors
const FIRE_PARTICLE_RADIUS = 14;
const FIRE_PARTICLE_SPACING = 24;
const MAX_FIRE_PARTICLES = 320;
const FIRE_LIFETIME = 2500; // milliseconds before fire particle dies
const FIRE_UPWARD_FORCE = 0.00045; // stronger upward force for more realistic rising
const BURN_DAMAGE_RATE = 0.025; // health reduction per frame when touching fire
const BURN_DISTANCE = 35; // distance at which fire can burn objects
const FIRE_BLUR_AMOUNT = 8; // Gaussian blur for fire glow
const FIRE_TURBULENCE_FREQ = 0.04; // Turbulence frequency for flame distortion
const FIRE_TURBULENCE_OCTAVES = 3; // Turbulence complexity
const BURN_GLOW_LIFETIME = 900; // milliseconds for burn glow to linger
const BURN_GLOW_BLUR = 14;
const BURN_GLOW_COLOR = 'rgba(255, 120, 40, 0.6)';

// Blackbody radiation color gradient (temperature-based: hot core -> cool edges)
// Based on Planck's law approximation for fire temperatures (800K - 1500K)
const getFireColor = (normalizedAge: number, intensity: number = 1): string => {
  // normalizedAge: 0 = just born (hottest), 1 = about to die (coolest)
  const heat = (1 - normalizedAge) * intensity;

  if (heat > 0.9) {
    // White-yellow core (hottest)
    return `rgba(255, 255, 220, ${heat})`;
  } else if (heat > 0.7) {
    // Bright yellow
    const r = 255;
    const g = Math.floor(200 + (heat - 0.7) * 275);
    const b = Math.floor(100 * (heat - 0.7) / 0.2);
    return `rgba(${r}, ${g}, ${b}, ${heat})`;
  } else if (heat > 0.5) {
    // Orange
    const r = 255;
    const g = Math.floor(120 + (heat - 0.5) * 400);
    const b = 0;
    return `rgba(${r}, ${g}, ${b}, ${heat})`;
  } else if (heat > 0.25) {
    // Red-orange
    const r = 255;
    const g = Math.floor((heat - 0.25) * 480);
    const b = 0;
    return `rgba(${r}, ${g}, ${b}, ${heat * 1.2})`;
  } else {
    // Dark red / smoke transition
    const r = Math.floor(180 + heat * 300);
    const g = 0;
    const b = 0;
    return `rgba(${r}, ${g}, ${b}, ${heat * 1.5})`;
  }
};

export default function HandTracker() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const physicsCanvasRef = useRef<HTMLCanvasElement>(null);
  const waterCanvasRef = useRef<HTMLCanvasElement>(null);
  const fireCanvasRef = useRef<HTMLCanvasElement>(null);
  const burnGlowCanvasRef = useRef<HTMLCanvasElement>(null);
  const threejsCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [handsDetected, setHandsDetected] = useState(0);
  const [isPinching, setIsPinching] = useState(false);
  const [isGrabbing, setIsGrabbing] = useState(false);
  const [isAntigravity, setIsAntigravity] = useState(false);
  const [currentMaterial, setCurrentMaterial] = useState<MaterialType>('solid');
  const [solidStyle, setSolidStyle] = useState<SolidStyle>('color');
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('drawing');
  const [particleCount, setParticleCount] = useState(0);
  const [pendingDrawingsCount, setPendingDrawingsCount] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [agentPrompt, setAgentPrompt] = useState<string | null>(null);

  // Matter.js refs
  const engineRef = useRef<Matter.Engine | null>(null);
  const renderRef = useRef<Matter.Render | null>(null);
  const runnerRef = useRef<Matter.Runner | null>(null);
  const boxesRef = useRef<Matter.Body[]>([]);
  const waterParticlesRef = useRef<Matter.Body[]>([]);
  const fireParticlesRef = useRef<Array<{ body: Matter.Body; createdAt: number; color: string }>>([]);
  const boxHealthRef = useRef<Map<Matter.Body, number>>(new Map()); // Track health of boxes
  const groundRef = useRef<Matter.Body | null>(null);
  const wallsRef = useRef<Matter.Body[]>([]);
  const waterAnimationRef = useRef<number | null>(null);
  const fireAnimationRef = useRef<number | null>(null);
  const burnGlowAnimationRef = useRef<number | null>(null);
  const burnGlowRef = useRef<Map<Matter.Body, { timestamp: number; level: number }>>(new Map());

  // Gesture tracking refs
  const pinchStartRef = useRef<{ x: number; y: number } | null>(null);
  const pinchCurrentRef = useRef<{ x: number; y: number } | null>(null);
  const currentMaterialRef = useRef<MaterialType>('solid');
  const solidStyleRef = useRef<SolidStyle>('color');
  const interactionModeRef = useRef<InteractionMode>('drawing');

  // Throwing/grabbing refs
  const grabbedBoxRef = useRef<Matter.Body | null>(null);
  const previousGrabPosRef = useRef<{ x: number; y: number } | null>(null);
  const grabVelocityRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Pending drawings (drawing mode only; converted to physics when switching to physics)
  const drawingsRef = useRef<PendingDrawing[]>([]);

  // Knuckles-together mode switch refs
  const knucklesCooldownRef = useRef(false);
  const prevKnucklesTogetherRef = useRef(false);
  const KNUCKLES_COOLDOWN_MS = 1000;

  // Three.js refs for 3D models
  const threeSceneRef = useRef<THREE.Scene | null>(null);
  const threeCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const threeRendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const threeModelsRef = useRef<Array<{
    mesh: THREE.Mesh;
    box: Matter.Body;
    scale: number;
    targetScale: number;
    color: string;
  }>>([]);

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

  // Initialize Three.js for 3D models
  const initializeThreeJS = () => {
    const canvas = threejsCanvasRef.current;
    if (!canvas) return;

    // Create scene
    const scene = new THREE.Scene();
    threeSceneRef.current = scene;

    // Create camera
    const camera = new THREE.PerspectiveCamera(75, 1280 / 720, 0.1, 2000);
    camera.position.z = 500;
    threeCameraRef.current = camera;

    // Create renderer
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
    });
    renderer.setSize(1280, 720);
    renderer.setClearColor(0x000000, 0);
    threeRendererRef.current = renderer;

    // Add lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(200, 500, 300);
    scene.add(directionalLight);

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);

      // Update 3D models to follow their 2D counterparts
      threeModelsRef.current.forEach((model, index) => {
        // Animate scale expansion
        if (model.scale < model.targetScale) {
          model.scale += 0.05;
          model.mesh.scale.set(model.scale, model.scale, model.scale);
        }

        // Update position and rotation to match physics body
        if (model.box && !model.box.isStatic) {
          model.mesh.position.set(
            model.box.position.x - 640,
            360 - model.box.position.y,
            0
          );
          // Only use the Z rotation from the physics body (2D rotation)
          model.mesh.rotation.z = model.box.angle;
        }
      });

      // Remove models for boxes that no longer exist
      threeModelsRef.current = threeModelsRef.current.filter(model => {
        const stillExists = boxesRef.current.includes(model.box);
        if (!stillExists) {
          scene.remove(model.mesh);
          model.mesh.geometry.dispose();
          (model.mesh.material as THREE.Material).dispose();
        }
        return stillExists;
      });

      renderer.render(scene, camera);
    };

    animate();
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

    // Add fire physics and burning mechanics
    Matter.Events.on(engine, 'beforeUpdate', () => {
      const now = Date.now();

      // Apply upward force to fire particles and remove expired ones
      fireParticlesRef.current = fireParticlesRef.current.filter(fireParticle => {
        const age = now - fireParticle.createdAt;

        // Remove if too old
        if (age > FIRE_LIFETIME) {
          Matter.World.remove(engine.world, fireParticle.body);
          return false;
        }

        // Apply upward force (fire rises)
        const upwardForce = FIRE_UPWARD_FORCE * (1 - age / FIRE_LIFETIME); // Weaker as it ages
        Matter.Body.applyForce(fireParticle.body, fireParticle.body.position, { x: 0, y: -upwardForce });

        // Add random horizontal drift for flame effect
        const drift = (Math.random() - 0.5) * 0.00005;
        Matter.Body.applyForce(fireParticle.body, fireParticle.body.position, { x: drift, y: 0 });

        // Fade out as it ages
        const opacity = 1 - (age / FIRE_LIFETIME);
        fireParticle.body.render.opacity = opacity;

        return true;
      });

      // Check for burning collisions
      fireParticlesRef.current.forEach(fireParticle => {
        boxesRef.current.forEach(box => {
          const dx = box.position.x - fireParticle.body.position.x;
          const dy = box.position.y - fireParticle.body.position.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          // If fire is close to box, damage it
          if (distance < BURN_DISTANCE) {
            const currentHealth = boxHealthRef.current.get(box) || 1.0;
            const newHealth = currentHealth - BURN_DAMAGE_RATE;
            boxHealthRef.current.set(box, newHealth);

            // Visual indication of burning (darken the box)
            const burnLevel = 1 - newHealth;
            if (box.render.fillStyle) {
              // Darken color based on burn level
              box.render.opacity = Math.max(0.3, 1 - burnLevel);
            }
            burnGlowRef.current.set(box, {
              timestamp: Date.now(),
              level: Math.min(1, burnLevel + 0.2)
            });

            // Remove box if health reaches 0
            if (newHealth <= 0) {
              Matter.World.remove(engine.world, box);
              boxHealthRef.current.delete(box);
              boxesRef.current = boxesRef.current.filter(b => b !== box);
            }
          }
        });
      });
    });

    // Start renderer and runner
    Matter.Render.run(render);
    const runner = Matter.Runner.create();
    runnerRef.current = runner;
    Matter.Runner.run(runner, engine);
  };

  // Create a physics box or water or fire based on material type
  const createBox = (start: { x: number; y: number }, end: { x: number; y: number }) => {
    if (currentMaterialRef.current === 'water') {
      createWater(start, end);
    } else if (currentMaterialRef.current === 'fire') {
      createFire(start, end);
    } else {
      createSolidBox(start, end);
    }
  };

  // Create a solid physics box (optional solidStyle override for converting pending drawings)
  const createSolidBox = (
    start: { x: number; y: number },
    end: { x: number; y: number },
    solidStyleOverride?: SolidStyle
  ) => {
    if (!engineRef.current) return;

    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);

    // Minimum size validation
    if (width < 20 || height < 20) return;

    const centerX = (start.x + end.x) / 2;
    const centerY = (start.y + end.y) / 2;

    // Random color
    const color = BOX_COLORS[Math.floor(Math.random() * BOX_COLORS.length)];
    const useWoodTexture = (solidStyleOverride ?? solidStyleRef.current) === 'wood';

    // Create Matter.js body
    const box = Matter.Bodies.rectangle(centerX, centerY, width, height, {
      restitution: 0.6,
      friction: 0.1,
      render: {
        fillStyle: color,
        ...(useWoodTexture
          ? {
              sprite: {
                texture: WOOD_TEXTURE_PATH,
                xScale: width / WOOD_TEXTURE_SIZE,
                yScale: height / WOOD_TEXTURE_SIZE
              }
            }
          : {})
      }
    });

    // Add to world
    Matter.World.add(engineRef.current.world, box);
    boxesRef.current.push(box);

    // Initialize health for this box
    boxHealthRef.current.set(box, 1.0);

    // FIFO removal if exceeding max boxes
    if (boxesRef.current.length > MAX_BOXES) {
      const oldestBox = boxesRef.current.shift();
      if (oldestBox && engineRef.current) {
        Matter.World.remove(engineRef.current.world, oldestBox);
        boxHealthRef.current.delete(oldestBox);
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

  // Create fire particles with realistic upward floating behavior
  const createFire = (start: { x: number; y: number }, end: { x: number; y: number }) => {
    if (!engineRef.current) return;

    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);

    // Minimum size validation
    if (width < 30 || height < 30) return;

    const minX = Math.min(start.x, end.x);
    const minY = Math.min(start.y, end.y);

    // Calculate grid dimensions
    const cols = Math.max(2, Math.floor(width / FIRE_PARTICLE_SPACING));
    const rows = Math.max(2, Math.floor(height / FIRE_PARTICLE_SPACING));

    // Check if we would exceed max particles
    const newParticleCount = cols * rows;
    if (fireParticlesRef.current.length + newParticleCount > MAX_FIRE_PARTICLES) {
      // Remove oldest particles to make room
      const toRemove = Math.min(
        fireParticlesRef.current.length,
        (fireParticlesRef.current.length + newParticleCount) - MAX_FIRE_PARTICLES
      );
      for (let i = 0; i < toRemove; i++) {
        const oldParticle = fireParticlesRef.current.shift();
        if (oldParticle && engineRef.current) {
          Matter.World.remove(engineRef.current.world, oldParticle.body);
        }
      }
    }

    // Create fire particles in a grid with randomness
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = minX + FIRE_PARTICLE_SPACING * col + FIRE_PARTICLE_SPACING / 2;
        const y = minY + FIRE_PARTICLE_SPACING * row + FIRE_PARTICLE_SPACING / 2;

        // Add randomness to initial position
        const randomX = x + (Math.random() - 0.5) * 8;
        const randomY = y + (Math.random() - 0.5) * 8;

        // Random intensity variation for each particle
        const intensity = 0.7 + Math.random() * 0.3;

        const particle = Matter.Bodies.circle(randomX, randomY, FIRE_PARTICLE_RADIUS, {
          restitution: 0.05,
          friction: 0.0,
          frictionAir: 0.015, // Less air friction for more floaty fire
          density: 0.0003, // Lighter particles rise better
          label: 'fire',
          render: {
            visible: false // We render fire ourselves with custom shader-like effect
          }
        });

        // Random initial velocity to avoid a dense, uniform rise
        Matter.Body.setVelocity(particle, {
          x: (Math.random() - 0.5) * 1.2,
          y: -(0.8 + Math.random() * 1.6)
        });

        Matter.World.add(engineRef.current.world, particle);
        fireParticlesRef.current.push({
          body: particle,
          createdAt: Date.now(),
          color: '', // Not used anymore - we compute color based on age
          intensity: intensity // Store intensity for variation
        } as any);
      }
    }
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

  // Render fire particles with realistic blackbody radiation colors and glow
  const renderFire = useCallback(() => {
    const fireCanvas = fireCanvasRef.current;
    if (!fireCanvas) return;

    const ctx = fireCanvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, fireCanvas.width, fireCanvas.height);

    const now = Date.now();

    // Sort particles by age (oldest/coolest first, newest/hottest on top)
    const sortedParticles = [...fireParticlesRef.current].sort((a, b) => {
      const ageA = now - a.createdAt;
      const ageB = now - b.createdAt;
      return ageB - ageA; // Oldest first (will be drawn first, under newer particles)
    });

    // Draw each fire particle with blackbody color based on age
    for (const fireParticle of sortedParticles) {
      const { x, y } = fireParticle.body.position;
      const age = now - fireParticle.createdAt;
      const normalizedAge = Math.min(age / FIRE_LIFETIME, 1);
      const intensity = (fireParticle as any).intensity || 1;

      // Calculate particle size - starts larger, shrinks as it ages
      const sizeMultiplier = 1.8 - normalizedAge * 0.8;
      const baseRadius = FIRE_PARTICLE_RADIUS * sizeMultiplier;

      // Add flickering effect using time-based noise
      const flicker = 0.85 + Math.sin(now * 0.02 + x * 0.1) * 0.15;
      const radius = baseRadius * flicker;

      // Get blackbody color based on age
      const color = getFireColor(normalizedAge, intensity);

      // Draw outer glow (larger, more transparent)
      const glowRadius = radius * 2.5;
      const glowGradient = ctx.createRadialGradient(x, y, 0, x, y, glowRadius);
      const glowColor = getFireColor(normalizedAge * 0.7, intensity * 0.4);
      glowGradient.addColorStop(0, glowColor);
      glowGradient.addColorStop(0.5, 'rgba(255, 100, 0, 0.1)');
      glowGradient.addColorStop(1, 'rgba(255, 50, 0, 0)');

      ctx.beginPath();
      ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
      ctx.fillStyle = glowGradient;
      ctx.fill();

      // Draw main fire particle with radial gradient for hot core
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);

      // Hot core (white/yellow) to outer edge (orange/red)
      const coreHeat = (1 - normalizedAge) * intensity;
      if (coreHeat > 0.6) {
        gradient.addColorStop(0, `rgba(255, 255, 240, ${coreHeat})`);
        gradient.addColorStop(0.3, `rgba(255, 220, 100, ${coreHeat * 0.9})`);
      } else {
        gradient.addColorStop(0, `rgba(255, 200, 50, ${coreHeat + 0.2})`);
        gradient.addColorStop(0.3, `rgba(255, 150, 0, ${coreHeat + 0.1})`);
      }
      gradient.addColorStop(0.6, color);
      gradient.addColorStop(1, 'rgba(100, 20, 0, 0)');

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      // Add bright spark at the very center for young particles
      if (normalizedAge < 0.3) {
        const sparkRadius = radius * 0.3 * (1 - normalizedAge / 0.3);
        ctx.beginPath();
        ctx.arc(x, y, sparkRadius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${(0.3 - normalizedAge) * 2})`;
        ctx.fill();
      }
    }

    // Schedule next frame
    fireAnimationRef.current = requestAnimationFrame(renderFire);
  }, []);

  // Render burn glow on boxes affected by fire (soft blur, no particles)
  const renderBurnGlow = useCallback(() => {
    const burnCanvas = burnGlowCanvasRef.current;
    if (!burnCanvas) return;

    const ctx = burnCanvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, burnCanvas.width, burnCanvas.height);

    const now = Date.now();
    for (const [box, info] of burnGlowRef.current.entries()) {
      if (!boxesRef.current.includes(box)) {
        burnGlowRef.current.delete(box);
        continue;
      }

      const age = now - info.timestamp;
      if (age > BURN_GLOW_LIFETIME) {
        burnGlowRef.current.delete(box);
        continue;
      }

      const width = box.bounds.max.x - box.bounds.min.x;
      const height = box.bounds.max.y - box.bounds.min.y;
      const radius = Math.max(width, height) * 0.7;
      const alpha = (1 - age / BURN_GLOW_LIFETIME) * (0.35 + info.level * 0.6);
      const x = box.position.x;
      const y = box.position.y;

      ctx.save();
      ctx.filter = `blur(${BURN_GLOW_BLUR}px)`;
      ctx.globalCompositeOperation = 'lighter';

      const gradient = ctx.createRadialGradient(x, y, radius * 0.2, x, y, radius);
      gradient.addColorStop(0, `rgba(255, 220, 160, ${alpha})`);
      gradient.addColorStop(0.6, `rgba(255, 140, 60, ${alpha * 0.7})`);
      gradient.addColorStop(1, 'rgba(120, 20, 0, 0)');

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.ellipse(x, y, width * 0.7, height * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    burnGlowAnimationRef.current = requestAnimationFrame(renderBurnGlow);
  }, []);

  const applyAgentBodies = useCallback((bodies: Array<Record<string, any>>) => {
    if (!engineRef.current) return;

    const created: Matter.Body[] = [];
    for (const bodySpec of bodies) {
      const { method, args = [], options } = bodySpec || {};
      if (!method || !Array.isArray(args)) continue;

      let body: Matter.Body | null = null;
      switch (method) {
        case 'rectangle':
          body = Matter.Bodies.rectangle(args[0], args[1], args[2], args[3], options);
          break;
        case 'circle':
          body = Matter.Bodies.circle(args[0], args[1], args[2], options, args[3]);
          break;
        case 'polygon':
          body = Matter.Bodies.polygon(args[0], args[1], args[2], args[3], options);
          break;
        case 'trapezoid':
          body = Matter.Bodies.trapezoid(args[0], args[1], args[2], args[3], args[4], options);
          break;
        case 'fromVertices':
          body = Matter.Bodies.fromVertices(args[0], args[1], args[2], options, args[3], args[4], args[5], args[6]) as Matter.Body;
          break;
        default:
          break;
      }

      if (body) {
        if (!body.render.fillStyle) {
          body.render.fillStyle = BOX_COLORS[Math.floor(Math.random() * BOX_COLORS.length)];
        }
        created.push(body);
      }
    }

    if (created.length > 0) {
      Matter.World.add(engineRef.current.world, created);
      boxesRef.current.push(...created);
      created.forEach(box => boxHealthRef.current.set(box, 1.0));
    }
  }, []);

  const handleAnalyzeFrame = useCallback(async () => {
    if (!canvasRef.current || isAnalyzing) return;

    try {
      setIsAnalyzing(true);
      const imageData = canvasRef.current.toDataURL('image/png');
      const response = await fetch('/api/shape-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageData })
      });

      if (!response.ok) {
        throw new Error('Failed to analyze frame.');
      }

      const data = await response.json();
      setAgentPrompt(data.prompt || null);
      if (Array.isArray(data.matterBodies)) {
        applyAgentBodies(data.matterBodies);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsAnalyzing(false);
    }
  }, [applyAgentBodies, isAnalyzing]);

  // Clear all boxes, particles, and pending drawings
  const clearAllBoxes = () => {
    drawingsRef.current = [];
    if (!engineRef.current) return;

    boxesRef.current.forEach(box => {
      Matter.World.remove(engineRef.current!.world, box);
    });
    boxesRef.current = [];
    boxHealthRef.current.clear();

    waterParticlesRef.current.forEach(particle => {
      Matter.World.remove(engineRef.current!.world, particle);
    });
    waterParticlesRef.current = [];

    fireParticlesRef.current.forEach(fireParticle => {
      Matter.World.remove(engineRef.current!.world, fireParticle.body);
    });
    fireParticlesRef.current = [];
    burnGlowRef.current.clear();

    // Clear 3D models
    if (threeSceneRef.current) {
      threeModelsRef.current.forEach(model => {
        threeSceneRef.current!.remove(model.mesh);
        model.mesh.geometry.dispose();
        (model.mesh.material as THREE.Material).dispose();
      });
      threeModelsRef.current = [];
    }

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

          // Draw pending drawings (drawing mode only — not yet physics)
          drawingsRef.current.forEach(d => {
            const minX = Math.min(d.start.x, d.end.x);
            const minY = Math.min(d.start.y, d.end.y);
            const w = Math.abs(d.end.x - d.start.x);
            const h = Math.abs(d.end.y - d.start.y);
            ctx.save();
            if (d.material === 'water') {
              ctx.fillStyle = 'rgba(77, 157, 224, 0.5)';
            } else if (d.material === 'fire') {
              ctx.fillStyle = 'rgba(255, 99, 71, 0.5)';
            } else {
              ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
            }
            ctx.strokeStyle = d.material === 'water' ? '#4D9DE0' : d.material === 'fire' ? '#FF6347' : '#FFFFFF';
            ctx.lineWidth = 2;
            ctx.fillRect(minX, minY, w, h);
            ctx.strokeRect(minX, minY, w, h);
            ctx.restore();
          });

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
                      ctx.strokeStyle = currentMaterialRef.current === 'water' ? '#4D9DE0' : currentMaterialRef.current === 'fire' ? '#FF6347' : '#FFFFFF';
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
                    // Release pinch — in drawing mode store as pending drawing (converted to physics when switching mode)
                    if (pinchStartRef.current && pinchCurrentRef.current) {
                      const start = pinchStartRef.current;
                      const end = pinchCurrentRef.current;
                      const w = Math.abs(end.x - start.x);
                      const h = Math.abs(end.y - start.y);
                      if (w >= 20 && h >= 20) {
                        drawingsRef.current.push({
                          start: { ...start },
                          end: { ...end },
                          material: currentMaterialRef.current,
                          solidStyle: solidStyleRef.current
                        });
                      }
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

            // Knuckles together: toggle drawing/physics mode when both hands' knuckles are pressed together
            if (results.multiHandLandmarks.length === 2) {
              let leftHandLandmarks: Landmark[] | null = null;
              let rightHandLandmarks: Landmark[] | null = null;

              for (let i = 0; i < results.multiHandLandmarks.length; i++) {
                const handedness = results.multiHandedness[i];
                if (handedness.label === 'Left') {
                  leftHandLandmarks = results.multiHandLandmarks[i] as Landmark[];
                } else {
                  rightHandLandmarks = results.multiHandLandmarks[i] as Landmark[];
                }
              }

              if (leftHandLandmarks && rightHandLandmarks) {
                const isKnucklesTogether = detectKnucklesTogetherGesture(leftHandLandmarks, rightHandLandmarks);

                // Detect onset (knuckles just came together) with cooldown → toggle drawing/physics
                if (isKnucklesTogether && !prevKnucklesTogetherRef.current && !knucklesCooldownRef.current) {
                  // Toggle interaction mode
                  const newMode: InteractionMode = interactionModeRef.current === 'drawing' ? 'physics' : 'drawing';
                  setInteractionMode(newMode);
                  interactionModeRef.current = newMode;

                  // When switching to physics: convert any pending drawings into physics objects
                  if (newMode === 'physics' && drawingsRef.current.length > 0) {
                    const toConvert = [...drawingsRef.current];
                    drawingsRef.current = [];
                    setPendingDrawingsCount(0);
                    toConvert.forEach(d => {
                      if (d.material === 'water') {
                        createWater(d.start, d.end);
                      } else if (d.material === 'fire') {
                        createFire(d.start, d.end);
                      } else {
                        createSolidBox(d.start, d.end, d.solidStyle);
                      }
                    });
                  }

                  // Clean up state from previous mode
                  if (grabbedBoxRef.current) {
                    Matter.Body.setStatic(grabbedBoxRef.current, false);
                    grabbedBoxRef.current = null;
                    previousGrabPosRef.current = null;
                    grabVelocityRef.current = { x: 0, y: 0 };
                    setIsGrabbing(false);
                  }
                  pinchStartRef.current = null;
                  pinchCurrentRef.current = null;
                  setIsPinching(false);

                  // Set cooldown
                  knucklesCooldownRef.current = true;
                  setTimeout(() => {
                    knucklesCooldownRef.current = false;
                  }, KNUCKLES_COOLDOWN_MS);
                }

                prevKnucklesTogetherRef.current = isKnucklesTogether;

                // Draw cyan line between knuckle centers when knuckles-together detected
                if (isKnucklesTogether) {
                  const knuckleIndices = [HandLandmark.INDEX_FINGER_MCP, HandLandmark.MIDDLE_FINGER_MCP, HandLandmark.RING_FINGER_MCP, HandLandmark.PINKY_MCP];
                  const leftCx = knuckleIndices.reduce((s, i) => s + leftHandLandmarks[i].x, 0) / 4;
                  const leftCy = knuckleIndices.reduce((s, i) => s + leftHandLandmarks[i].y, 0) / 4;
                  const rightCx = knuckleIndices.reduce((s, i) => s + rightHandLandmarks[i].x, 0) / 4;
                  const rightCy = knuckleIndices.reduce((s, i) => s + rightHandLandmarks[i].y, 0) / 4;
                  ctx.save();
                  ctx.strokeStyle = '#22D3EE';
                  ctx.lineWidth = 4;
                  ctx.shadowColor = '#22D3EE';
                  ctx.shadowBlur = 12;
                  ctx.beginPath();
                  ctx.moveTo(leftCx * canvas.width, leftCy * canvas.height);
                  ctx.lineTo(rightCx * canvas.width, rightCy * canvas.height);
                  ctx.stroke();
                  ctx.restore();
                }
              }
            } else {
              prevKnucklesTogetherRef.current = false;
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

        // Initialize Three.js for 3D models
        initializeThreeJS();

        // Start water rendering loop
        renderWater();

        // Start fire rendering loop
        renderFire();

        // Start burn glow rendering loop
        renderBurnGlow();

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
      if (fireAnimationRef.current) {
        cancelAnimationFrame(fireAnimationRef.current);
      }
      if (burnGlowAnimationRef.current) {
        cancelAnimationFrame(burnGlowAnimationRef.current);
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
      // Cleanup Three.js
      if (threeRendererRef.current) {
        threeRendererRef.current.dispose();
      }
      if (threeSceneRef.current) {
        threeModelsRef.current.forEach(model => {
          threeSceneRef.current!.remove(model.mesh);
          model.mesh.geometry.dispose();
          (model.mesh.material as THREE.Material).dispose();
        });
      }
    };
  }, [renderWater, renderFire, renderBurnGlow]);

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
          {/* Realistic fire filter with turbulence distortion and glow */}
          <filter id="fire-filter" x="-50%" y="-50%" width="200%" height="200%">
            {/* Turbulence for flame distortion effect */}
            <feTurbulence
              type="fractalNoise"
              baseFrequency={FIRE_TURBULENCE_FREQ}
              numOctaves={FIRE_TURBULENCE_OCTAVES}
              seed="5"
              result="turbulence"
            >
              <animate
                attributeName="baseFrequency"
                values="0.03;0.05;0.03"
                dur="3s"
                repeatCount="indefinite"
              />
            </feTurbulence>
            {/* Displacement map for wavy flame effect */}
            <feDisplacementMap
              in="SourceGraphic"
              in2="turbulence"
              scale="8"
              xChannelSelector="R"
              yChannelSelector="G"
              result="displaced"
            />
            {/* Soft blur for glow */}
            <feGaussianBlur in="displaced" stdDeviation={FIRE_BLUR_AMOUNT} result="blur" />
            {/* Composite the blurred glow with original */}
            <feComposite in="SourceGraphic" in2="blur" operator="over" result="composite" />
            {/* Color enhancement for fire brightness */}
            <feColorMatrix
              in="composite"
              type="matrix"
              values="1.2 0 0 0 0.1  0 1 0 0 0  0 0 0.8 0 0  0 0 0 1 0"
            />
          </filter>
        </defs>
      </svg>

      {/* Control panel — glass card */}
      <div className="absolute top-4 right-4 z-10 w-56 rounded-2xl border border-white/10 bg-zinc-900/80 backdrop-blur-xl shadow-xl text-zinc-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-white/5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Mode</span>
            <span className={`shrink-0 px-2.5 py-0.5 rounded-full text-xs font-medium ${
              interactionMode === 'drawing'
                ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30'
                : 'bg-sky-500/20 text-sky-400 ring-1 ring-sky-500/30'
            }`}>
              {interactionMode === 'drawing' ? 'Drawing' : 'Physics'}
            </span>
          </div>
          <p className="mt-1 text-[10px] text-zinc-500">Cross arms to toggle</p>
        </div>

        {interactionMode === 'drawing' && (
          <div className="px-4 py-3 border-b border-white/5 space-y-3">
            <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Material</span>
            <div className="flex flex-wrap gap-1.5">
              {[
                { id: 'solid' as const, label: 'Solid' },
                { id: 'water' as const, label: 'Water' },
                { id: 'fire' as const, label: 'Fire' },
              ].map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => {
                    setCurrentMaterial(id);
                    currentMaterialRef.current = id;
                  }}
                  className={`shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    currentMaterial === id
                      ? id === 'fire'
                        ? 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/30'
                        : 'bg-sky-500/20 text-sky-400 ring-1 ring-sky-500/30'
                      : 'bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {currentMaterial === 'solid' && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                <button
                  onClick={() => {
                    setSolidStyle('color');
                    solidStyleRef.current = 'color';
                  }}
                  className={`shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    solidStyle === 'color'
                      ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30'
                      : 'bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-300'
                  }`}
                >
                  Color
                </button>
                <button
                  onClick={() => {
                    setSolidStyle('wood');
                    solidStyleRef.current = 'wood';
                  }}
                  className={`shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    solidStyle === 'wood'
                      ? 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/30'
                      : 'bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-300'
                  }`}
                >
                  Wood
                </button>
              </div>
            )}
          </div>
        )}

        <div className="px-4 py-3 flex flex-col gap-2">
          <button
            onClick={handleAnalyzeFrame}
            disabled={isAnalyzing}
            className="w-full py-2 rounded-xl text-xs font-medium transition-colors bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/30 hover:bg-violet-500/30 disabled:opacity-50 disabled:pointer-events-none"
          >
            {isAnalyzing ? 'Analyzing…' : 'Analyze frame'}
          </button>
          <button
            onClick={clearAllBoxes}
            className="w-full py-2 rounded-xl text-xs font-medium transition-colors bg-red-500/10 text-red-400/90 ring-1 ring-red-500/20 hover:bg-red-500/20"
          >
            Clear all ({boxesRef.current.length + particleCount + fireParticlesRef.current.length + (interactionMode === 'drawing' ? pendingDrawingsCount : 0)})
          </button>
        </div>
      </div>

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-zinc-950/80 backdrop-blur-sm">
          <div className="h-10 w-10 rounded-full border-2 border-zinc-600 border-t-zinc-200 animate-spin" />
          <span className="text-sm text-zinc-400">Starting camera…</span>
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

      {/* Fire canvas with realistic flame filter (above water, below physics) */}
      <canvas
        ref={fireCanvasRef}
        className="absolute max-w-full max-h-full pointer-events-none"
        width={1280}
        height={720}
        style={{
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          filter: 'url(#fire-filter)',
          mixBlendMode: 'screen', // Additive blending for realistic fire glow
          zIndex: 1.5
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

      {/* Burn glow overlay for heated boxes */}
      <canvas
        ref={burnGlowCanvasRef}
        className="absolute max-w-full max-h-full pointer-events-none"
        width={1280}
        height={720}
        style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 2.4 }}
      />

      {/* Three.js canvas for 3D models */}
      <canvas
        ref={threejsCanvasRef}
        className="absolute max-w-full max-h-full pointer-events-none"
        width={1280}
        height={720}
        style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 3 }}
      />

    </div>
  );
}
