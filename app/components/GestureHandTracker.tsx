'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  analyzeGesture,
  GestureState,
  normalizeToScreen,
  rotationToSliderValue,
  Landmark,
} from '../utils/gestureDetection';
import RotatingCube from './RotatingCube';

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

interface Point {
  id: string;
  x: number;
  y: number;
  timestamp: number;
  gesture: string;
}

interface HandData {
  gesture: GestureState;
  handedness: string; // 'Left' or 'Right'
}

export default function GestureHandTracker() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hands, setHands] = useState<HandData[]>([]);
  const [points, setPoints] = useState<Point[]>([]);
  const canvasSize = { width: 1280, height: 720 };

  // Track previous pinch state to detect new pinches
  const prevPinchState = useRef<Map<string, boolean>>(new Map());

  // Handle creating points when pinching
  const handlePinchPoint = useCallback((handData: HandData, handIndex: number) => {
    handData.gesture.pinches.forEach((pinch) => {
      const pinchKey = `${handData.handedness}-${pinch.fingers.join('-')}`;
      const wasPinching = prevPinchState.current.get(pinchKey) || false;

      // Detect new pinch (transition from not pinching to pinching)
      if (pinch.isPinching && !wasPinching && pinch.strength > 0.8) {
        const screenPos = normalizeToScreen(
          pinch.position,
          canvasSize.width,
          canvasSize.height
        );

        const newPoint: Point = {
          id: `${Date.now()}-${handIndex}`,
          x: screenPos.x,
          y: screenPos.y,
          timestamp: Date.now(),
          gesture: pinch.fingers.join('+'),
        };

        setPoints((prev) => [...prev, newPoint]);
      }

      prevPinchState.current.set(pinchKey, pinch.isPinching);
    });
  }, [canvasSize]);

  useEffect(() => {
    let camera: any = null;
    let handsModel: any = null;

    const initializeHandTracking = async () => {
      try {
        const video = videoRef.current;
        const canvas = canvasRef.current;

        if (!video || !canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Wait for MediaPipe to be available
        await waitForMediaPipe();

        // Initialize Hands model
        handsModel = new (window as any).Hands({
          locateFile: (file: string) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/${file}`;
          }
        });

        handsModel.setOptions({
          selfieMode: true,
          maxNumHands: 2,
          modelComplexity: 1,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5
        });

        // Set up results callback
        handsModel.onResults((results: any) => {
          // Clear canvas
          ctx.save();
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          // Draw the video frame
          ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

          const detectedHands: HandData[] = [];

          // Draw hand landmarks and analyze gestures
          if (results.multiHandLandmarks && results.multiHandedness) {
            for (let i = 0; i < results.multiHandLandmarks.length; i++) {
              const landmarks: Landmark[] = results.multiHandLandmarks[i];
              const handedness = results.multiHandedness[i].label;
              const isRightHand = handedness === 'Right';

              // Analyze gestures
              const gesture = analyzeGesture(landmarks);
              detectedHands.push({ gesture, handedness });

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

              // Highlight pinching fingers
              gesture.pinches.forEach((pinch) => {
                if (pinch.isPinching) {
                  const screenPos = normalizeToScreen(
                    pinch.position,
                    canvas.width,
                    canvas.height
                  );

                  // Draw pinch indicator
                  ctx.beginPath();
                  ctx.arc(screenPos.x, screenPos.y, 10 + pinch.strength * 10, 0, 2 * Math.PI);
                  ctx.strokeStyle = isRightHand ? '#00FF00' : '#FF0000';
                  ctx.lineWidth = 3;
                  ctx.stroke();

                  // Draw filled circle for strong pinch
                  if (pinch.strength > 0.8) {
                    ctx.beginPath();
                    ctx.arc(screenPos.x, screenPos.y, 5, 0, 2 * Math.PI);
                    ctx.fillStyle = isRightHand ? '#00FF00' : '#FF0000';
                    ctx.fill();
                  }
                }
              });

              // Draw palm center
              const palmScreen = normalizeToScreen(
                gesture.palmCenter,
                canvas.width,
                canvas.height
              );
              ctx.beginPath();
              ctx.arc(palmScreen.x, palmScreen.y, 5, 0, 2 * Math.PI);
              ctx.fillStyle = 'yellow';
              ctx.fill();
            }

            setHands(detectedHands);

            // Handle pinch points
            detectedHands.forEach((hand, index) => {
              handlePinchPoint(hand, index);
            });
          } else {
            setHands([]);
          }

          ctx.restore();

          // Draw persistent points
          points.forEach((point) => {
            ctx.beginPath();
            ctx.arc(point.x, point.y, 8, 0, 2 * Math.PI);
            ctx.fillStyle = 'rgba(255, 255, 0, 0.8)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Draw gesture label
            ctx.fillStyle = 'white';
            ctx.font = '12px monospace';
            ctx.fillText(point.gesture, point.x + 12, point.y - 5);
          });
        });

        // Initialize camera
        camera = new window.Camera(video, {
          onFrame: async () => {
            if (video && handsModel) {
              await handsModel.send({ image: video });
            }
          },
          width: 1280,
          height: 720
        });

        await camera.start();
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
      if (handsModel) {
        handsModel.close();
      }
    };
  }, [handlePinchPoint, points]);

  // Wait for MediaPipe to be available
  const waitForMediaPipe = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      const checkMediaPipe = () => {
        if (
          (window as any).Hands &&
          (window as any).drawConnectors &&
          (window as any).drawLandmarks &&
          (window as any).HAND_CONNECTIONS &&
          (window as any).Camera
        ) {
          resolve();
        } else {
          setTimeout(checkMediaPipe, 100);
        }
      };

      // Start checking
      checkMediaPipe();

      // Timeout after 10 seconds
      setTimeout(() => {
        reject(new Error('MediaPipe failed to load'));
      }, 10000);
    });
  };

  const clearPoints = () => {
    setPoints([]);
  };

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center bg-black">
      {/* Status bar */}
      <div className="absolute top-4 left-4 z-10 bg-black/90 text-white px-4 py-2 rounded-lg max-w-sm">
        {isLoading ? (
          <span>Loading hand tracking...</span>
        ) : error ? (
          <span className="text-red-400">{error}</span>
        ) : (
          <div className="space-y-1 text-sm">
            <div className="font-semibold">
              {hands.length === 0 ? 'No hands detected' : `${hands.length} hand${hands.length > 1 ? 's' : ''} detected`}
            </div>
            <div className="text-xs text-gray-300">Points: {points.length}</div>
          </div>
        )}
      </div>

      {/* 3D Rotating Cubes */}
      {hands.map((hand, index) => (
        <div
          key={`cube-${index}`}
          className={`absolute ${index === 0 ? 'top-4 right-[280px]' : 'top-32 right-[280px]'} z-10 w-[200px] h-[200px]`}
        >
          <RotatingCube rotation={hand.gesture.rotation} handedness={hand.handedness} />
        </div>
      ))}

      {/* Gesture Info Panels */}
      {hands.map((hand, index) => (
        <div
          key={index}
          className={`absolute ${index === 0 ? 'top-4 right-4' : 'top-32 right-4'} z-10 bg-black/90 text-white px-4 py-3 rounded-lg min-w-[250px]`}
        >
          <div className="font-semibold mb-2 text-sm border-b border-gray-600 pb-1">
            {hand.handedness} Hand
          </div>

          {/* Pinch Status */}
          <div className="text-xs space-y-1 mb-2">
            <div className="text-gray-400">Pinches:</div>
            {hand.gesture.pinches.length === 0 ? (
              <div className="text-gray-500 ml-2">None</div>
            ) : (
              hand.gesture.pinches.map((pinch, i) => (
                <div key={i} className="ml-2 flex items-center gap-2">
                  <span className={hand.handedness === 'Right' ? 'text-green-400' : 'text-red-400'}>
                    {pinch.fingers.join(' + ')}
                  </span>
                  <div className="flex-1 bg-gray-700 h-1.5 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${hand.handedness === 'Right' ? 'bg-green-400' : 'bg-red-400'}`}
                      style={{ width: `${pinch.strength * 100}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Rotation (Slider Values) */}
          <div className="text-xs space-y-1">
            <div className="text-gray-400">Rotation (Sliders):</div>
            <div className="ml-2 space-y-0.5">
              <div className="flex justify-between">
                <span className="text-gray-300">Roll:</span>
                <span className="font-mono">{hand.gesture.rotation.roll.toFixed(1)}°</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-300">Pitch:</span>
                <span className="font-mono">{hand.gesture.rotation.pitch.toFixed(1)}°</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-300">Yaw:</span>
                <span className="font-mono">{hand.gesture.rotation.yaw.toFixed(1)}°</span>
              </div>
            </div>
          </div>

          {/* Finger States */}
          <div className="text-xs mt-2">
            <div className="text-gray-400 mb-1">Fingers:</div>
            <div className="flex gap-1 ml-2">
              {Object.entries(hand.gesture.fingerStates).map(([finger, extended]) => (
                <div
                  key={finger}
                  className={`px-1.5 py-0.5 rounded text-[10px] ${
                    extended ? 'bg-green-600' : 'bg-gray-700'
                  }`}
                >
                  {finger[0].toUpperCase()}
                </div>
              ))}
            </div>
          </div>

          {/* Gesture States */}
          <div className="text-xs mt-2 flex gap-2">
            {hand.gesture.isOpen && (
              <span className="px-2 py-0.5 bg-blue-600 rounded text-[10px]">OPEN</span>
            )}
            {hand.gesture.isFist && (
              <span className="px-2 py-0.5 bg-purple-600 rounded text-[10px]">FIST</span>
            )}
          </div>
        </div>
      ))}

      {/* Controls */}
      <div className="absolute bottom-4 right-4 z-10 flex gap-2">
        <button
          onClick={clearPoints}
          className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          Clear Points ({points.length})
        </button>
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

      {/* Instructions */}
      <div className="absolute bottom-4 left-4 bg-black/90 text-white p-4 rounded-lg text-xs max-w-md">
        <p className="font-semibold mb-2">Gesture Controls:</p>
        <ul className="space-y-1 text-[11px] text-gray-300">
          <li>• <span className="text-yellow-400">Rotate your hand</span> to see the 3D cube rotate in real-time!</li>
          <li>• <span className="text-yellow-400">Pinch thumb + index</span> to create points</li>
          <li>• <span className="text-yellow-400">Try different finger combinations</span> (thumb + middle, thumb + ring)</li>
          <li>• <span className="text-green-400">Green cube/hand</span> = Right, <span className="text-red-400">Red cube/hand</span> = Left</li>
          <li>• Strong pinches create yellow points on screen</li>
          <li>• Watch rotation values update as you twist, tilt, and turn your hand</li>
        </ul>
      </div>
    </div>
  );
}
