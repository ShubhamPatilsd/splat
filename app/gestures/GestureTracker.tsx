'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  analyzeGesture,
  GestureState,
  normalizeToScreen,
  rotationToSliderValue,
  Landmark,
} from '../utils/gestureDetection';

declare global {
  interface Window {
    Hands: any;
    drawConnectors: any;
    drawLandmarks: any;
    HAND_CONNECTIONS: any;
    Camera: any;
  }
}

interface HandData {
  gesture: GestureState;
  handedness: string;
}

interface GestureCombo {
  name: string;
  active: boolean;
  timestamp: number;
}

interface MenuItem {
  name: string;
  icon: string;
  startAngle: number;
  endAngle: number;
  color: string;
}

export default function GestureTracker() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hands, setHands] = useState<HandData[]>([]);
  const [gestureCombos, setGestureCombos] = useState<GestureCombo[]>([]);

  // Radial menu configuration - 4 quadrants within 270° range
  // Based on actual hand roll: pointing up ≈ -90°, range from -135° to 135°
  const menuItems: MenuItem[] = [
    { name: 'Pen', icon: '🖊️', startAngle: -135, endAngle: -67.5, color: '#3B82F6' },    // Blue (wrist far left)
    { name: 'Pencil', icon: '✏️', startAngle: -67.5, endAngle: 0, color: '#10B981' },     // Green (pointing up)
    { name: 'Brush', icon: '🖌️', startAngle: 0, endAngle: 67.5, color: '#F59E0B' },      // Orange (wrist right)
    { name: 'Eraser', icon: '🧹', startAngle: 67.5, endAngle: 135, color: '#EF4444' },   // Red (wrist far right)
  ];

  // Get selected menu item based on roll angle
  const getSelectedMenuItem = (rollAngle: number): MenuItem | null => {
    // Find which menu item range the roll angle falls into
    for (const item of menuItems) {
      if (rollAngle >= item.startAngle && rollAngle < item.endAngle) {
        return item;
      }
    }

    return menuItems[1]; // Default to Pencil if out of range
  };

  // Detect gesture combinations
  const detectGestureCombos = useCallback((handData: HandData[]) => {
    const combos: GestureCombo[] = [];

    handData.forEach((hand, index) => {
      const g = hand.gesture;

      // Pinch + specific rotation
      if (g.pinches.length > 0) {
        const primaryPinch = g.pinches[0];

        // Pinch + Twist (roll > 45° or < -45°)
        if (Math.abs(g.rotation.roll) > 45) {
          combos.push({
            name: `${hand.handedness}: Pinch + Twist ${g.rotation.roll > 0 ? 'Right' : 'Left'}`,
            active: true,
            timestamp: Date.now()
          });
        }

        // Pinch + Tilt Forward/Back
        if (Math.abs(g.rotation.pitch) > 30) {
          combos.push({
            name: `${hand.handedness}: Pinch + Tilt ${g.rotation.pitch > 0 ? 'Forward' : 'Back'}`,
            active: true,
            timestamp: Date.now()
          });
        }

        // Strong Pinch (> 90% strength)
        if (primaryPinch.strength > 0.9) {
          combos.push({
            name: `${hand.handedness}: Strong ${primaryPinch.fingers.join('+')} Pinch`,
            active: true,
            timestamp: Date.now()
          });
        }
      }

      // Fist + Rotation
      if (g.isFist && Math.abs(g.rotation.roll) > 30) {
        combos.push({
          name: `${hand.handedness}: Fist Twist ${g.rotation.roll > 0 ? 'Right' : 'Left'}`,
          active: true,
          timestamp: Date.now()
        });
      }

      // Open hand + specific rotation
      if (g.isOpen && Math.abs(g.rotation.yaw) > 40) {
        combos.push({
          name: `${hand.handedness}: Open Hand Turn ${g.rotation.yaw > 0 ? 'Right' : 'Left'}`,
          active: true,
          timestamp: Date.now()
        });
      }

      // Peace sign detection
      if (g.fingerStates.index && g.fingerStates.middle &&
          !g.fingerStates.ring && !g.fingerStates.pinky) {
        combos.push({
          name: `${hand.handedness}: Peace Sign ✌️`,
          active: true,
          timestamp: Date.now()
        });
      }

      // Pointing
      if (g.fingerStates.index && !g.fingerStates.middle &&
          !g.fingerStates.ring && !g.fingerStates.pinky) {
        combos.push({
          name: `${hand.handedness}: Pointing 👉`,
          active: true,
          timestamp: Date.now()
        });
      }
    });

    // Two-hand combos
    if (handData.length === 2) {
      const [hand1, hand2] = handData;

      // Both hands pinching
      if (hand1.gesture.pinches.length > 0 && hand2.gesture.pinches.length > 0) {
        combos.push({
          name: 'Both Hands Pinching',
          active: true,
          timestamp: Date.now()
        });
      }

      // Both hands open
      if (hand1.gesture.isOpen && hand2.gesture.isOpen) {
        combos.push({
          name: 'Both Hands Open',
          active: true,
          timestamp: Date.now()
        });
      }

      // Opposite rotations
      if ((hand1.gesture.rotation.roll > 30 && hand2.gesture.rotation.roll < -30) ||
          (hand1.gesture.rotation.roll < -30 && hand2.gesture.rotation.roll > 30)) {
        combos.push({
          name: 'Opposite Twists (Zoom Gesture)',
          active: true,
          timestamp: Date.now()
        });
      }
    }

    setGestureCombos(combos);
  }, []);

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

        // Load MediaPipe scripts
        await loadMediaPipeScripts();

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
          ctx.save();
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

          const detectedHands: HandData[] = [];

          if (results.multiHandLandmarks && results.multiHandedness) {
            for (let i = 0; i < results.multiHandLandmarks.length; i++) {
              const landmarks: Landmark[] = results.multiHandLandmarks[i];
              const handedness = results.multiHandedness[i].label;
              const isRightHand = handedness === 'Right';

              const gesture = analyzeGesture(landmarks);
              detectedHands.push({ gesture, handedness });

              // Draw hand
              window.drawConnectors(
                ctx,
                landmarks,
                window.HAND_CONNECTIONS,
                { color: isRightHand ? '#00FF00' : '#FF0000', lineWidth: 2 }
              );

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

              // Highlight pinches
              gesture.pinches.forEach((pinch) => {
                if (pinch.isPinching) {
                  const screenPos = normalizeToScreen(
                    pinch.position,
                    canvas.width,
                    canvas.height
                  );

                  ctx.beginPath();
                  ctx.arc(screenPos.x, screenPos.y, 15 + pinch.strength * 15, 0, 2 * Math.PI);
                  ctx.strokeStyle = isRightHand ? '#00FF00' : '#FF0000';
                  ctx.lineWidth = 3;
                  ctx.stroke();

                  if (pinch.strength > 0.8) {
                    ctx.beginPath();
                    ctx.arc(screenPos.x, screenPos.y, 8, 0, 2 * Math.PI);
                    ctx.fillStyle = '#FFFF00';
                    ctx.fill();
                  }
                }
              });

              // Draw radial menu for LEFT HAND when palm is open
              if (!isRightHand && gesture.isOpen) {
                const palmPos = normalizeToScreen(
                  gesture.palmCenter,
                  canvas.width,
                  canvas.height
                );

                const menuRadius = 120;
                const innerRadius = 40;
                const selectedItem = getSelectedMenuItem(gesture.rotation.roll);

                // Draw menu segments
                menuItems.forEach((item) => {
                  // Draw at actual angles (no offset)
                  const startAngle = item.startAngle * Math.PI / 180;
                  const endAngle = item.endAngle * Math.PI / 180;
                  const isSelected = selectedItem?.name === item.name;

                  // Draw segment
                  ctx.beginPath();
                  ctx.arc(palmPos.x, palmPos.y, menuRadius, startAngle, endAngle);
                  ctx.arc(palmPos.x, palmPos.y, innerRadius, endAngle, startAngle, true);
                  ctx.closePath();

                  // Fill with color (brighter if selected)
                  ctx.fillStyle = isSelected ? item.color : item.color + '80'; // 80 = 50% opacity
                  ctx.fill();

                  // Outline
                  ctx.strokeStyle = isSelected ? '#FFFFFF' : '#FFFFFF40';
                  ctx.lineWidth = isSelected ? 3 : 1;
                  ctx.stroke();

                  // Draw icon at actual angle (no offset)
                  const midAngleDeg = (item.startAngle + item.endAngle) / 2;
                  const midAngle = midAngleDeg * Math.PI / 180;
                  const iconRadius = (menuRadius + innerRadius) / 2;
                  const iconX = palmPos.x + Math.cos(midAngle) * iconRadius;
                  const iconY = palmPos.y + Math.sin(midAngle) * iconRadius;

                  ctx.font = isSelected ? 'bold 24px sans-serif' : '20px sans-serif';
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'middle';
                  ctx.fillStyle = '#FFFFFF';
                  ctx.fillText(item.icon, iconX, iconY);
                });

                // Draw disabled zone (the 90° where hand can't rotate)
                // From 135° to -135° (or 135° to 225° in 0-360 range)
                const disabledStartAngle = (135) * Math.PI / 180;
                const disabledEndAngle = (225) * Math.PI / 180;
                ctx.beginPath();
                ctx.arc(palmPos.x, palmPos.y, menuRadius, disabledStartAngle, disabledEndAngle);
                ctx.arc(palmPos.x, palmPos.y, innerRadius, disabledEndAngle, disabledStartAngle, true);
                ctx.closePath();
                ctx.fillStyle = '#00000080';
                ctx.fill();
                ctx.strokeStyle = '#FFFFFF20';
                ctx.lineWidth = 1;
                ctx.stroke();

                // Draw center circle
                ctx.beginPath();
                ctx.arc(palmPos.x, palmPos.y, innerRadius, 0, 2 * Math.PI);
                ctx.fillStyle = '#000000CC';
                ctx.fill();
                ctx.strokeStyle = '#FFFFFF';
                ctx.lineWidth = 2;
                ctx.stroke();

                // Draw selected item name in center
                if (selectedItem) {
                  ctx.font = 'bold 12px sans-serif';
                  ctx.fillStyle = '#FFFFFF';
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'middle';
                  ctx.fillText(selectedItem.name, palmPos.x, palmPos.y - 8);

                  // Debug: show roll angle
                  ctx.font = '9px monospace';
                  ctx.fillStyle = '#AAAAAA';
                  ctx.fillText(`${gesture.rotation.roll.toFixed(0)}°`, palmPos.x, palmPos.y + 8);
                }

                // Draw roll indicator line at actual angle
                const rollAngle = gesture.rotation.roll * Math.PI / 180;
                const lineStartX = palmPos.x + Math.cos(rollAngle) * innerRadius;
                const lineStartY = palmPos.y + Math.sin(rollAngle) * innerRadius;
                const lineEndX = palmPos.x + Math.cos(rollAngle) * menuRadius;
                const lineEndY = palmPos.y + Math.sin(rollAngle) * menuRadius;

                ctx.beginPath();
                ctx.moveTo(lineStartX, lineStartY);
                ctx.lineTo(lineEndX, lineEndY);
                ctx.strokeStyle = '#FFFF00';
                ctx.lineWidth = 3;
                ctx.stroke();
              }
            }

            setHands(detectedHands);
            detectGestureCombos(detectedHands);
          } else {
            setHands([]);
            setGestureCombos([]);
          }

          ctx.restore();
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
        setError('Failed to initialize hand tracking.');
        setIsLoading(false);
      }
    };

    initializeHandTracking();

    return () => {
      if (camera) camera.stop();
      if (handsModel) handsModel.close();
    };
  }, [detectGestureCombos]);

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
            setTimeout(() => resolve(), 100);
          }
        };
        script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
        document.head.appendChild(script);
      });
    });
  };

  return (
    <div className="relative w-full h-full bg-gradient-to-br from-gray-900 via-black to-gray-900">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-20 bg-black/80 backdrop-blur-sm border-b border-gray-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Gesture Tracker</h1>
            <p className="text-sm text-gray-400">Real-time hand gesture detection and combinations</p>
          </div>
          <div className="text-right">
            <div className="text-sm text-gray-400">Hands Detected</div>
            <div className="text-3xl font-bold text-white">{hands.length}</div>
          </div>
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-30">
          <div className="text-center">
            <div className="w-16 h-16 border-4 border-white/20 border-t-white rounded-full animate-spin mx-auto mb-4" />
            <p className="text-white">Loading hand tracking...</p>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="absolute top-24 left-1/2 transform -translate-x-1/2 z-20 bg-red-600 text-white px-6 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Main Content Grid */}
      <div className="absolute inset-0 pt-24 pb-6 px-6 grid grid-cols-3 gap-6">
        {/* Left Column - Camera Feed */}
        <div className="col-span-2 flex flex-col gap-4">
          <div className="relative bg-black rounded-lg overflow-hidden flex-1 flex items-center justify-center">
            <video ref={videoRef} className="hidden" playsInline />
            <canvas
              ref={canvasRef}
              className="max-w-full max-h-full"
              width={1280}
              height={720}
            />
          </div>

          {/* Gesture Combinations Display */}
          <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-4 border border-gray-700">
            <h3 className="text-lg font-semibold text-white mb-3">Active Gesture Combinations</h3>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {gestureCombos.length === 0 ? (
                <div className="col-span-2 text-center text-gray-500 py-4">
                  No gesture combinations detected
                </div>
              ) : (
                gestureCombos.map((combo, idx) => (
                  <div
                    key={idx}
                    className="bg-green-600/20 border border-green-500/50 rounded-lg px-3 py-2 text-green-400 text-sm font-medium animate-pulse"
                  >
                    {combo.name}
                  </div>
                ))
              )}
            </div>

            {/* Radial Menu Instructions */}
            <div className="mt-3 pt-3 border-t border-gray-700">
              <div className="text-xs text-gray-400 space-y-1">
                <p className="font-semibold text-purple-400 mb-2">🎯 Radial Menu Controls:</p>
                <p>• Show your <span className="text-red-400 font-semibold">LEFT HAND</span> with palm open (all fingers spread)</p>
                <p>• Radial menu appears on your palm center (270° range)</p>
                <p>• <span className="text-yellow-400 font-semibold">Rotate your wrist left/right</span> to select tools</p>
                <p>• Hand pointing <strong>up</strong> = <span className="text-green-400">✏️ Pencil</span> | Rotate <strong>left</strong> = <span className="text-blue-400">🖊️ Pen</span> | Rotate <strong>right</strong> = <span className="text-orange-400">🖌️ Brush</span> or <span className="text-red-400">🧹 Eraser</span></p>
                <p>• Yellow line and angle value show current rotation</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column - Detailed Hand Data */}
        <div className="flex flex-col gap-4 overflow-y-auto">
          {hands.map((hand, index) => (
            <div
              key={index}
              className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-4 border-2"
              style={{
                borderColor: hand.handedness === 'Right' ? '#00ff00' : '#ff0000'
              }}
            >
              {/* Hand Header */}
              <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-700">
                <h3 className="text-xl font-bold text-white">
                  {hand.handedness} Hand
                </h3>
                <div className="flex gap-2">
                  {hand.gesture.isOpen && (
                    <span className="px-2 py-1 bg-blue-600 rounded text-xs font-semibold text-white">
                      OPEN
                    </span>
                  )}
                  {hand.gesture.isFist && (
                    <span className="px-2 py-1 bg-purple-600 rounded text-xs font-semibold text-white">
                      FIST
                    </span>
                  )}
                </div>
              </div>

              {/* Radial Menu Selection - Only for Left Hand when Open */}
              {hand.handedness === 'Left' && hand.gesture.isOpen && (
                <div className="mb-4 p-3 bg-gradient-to-r from-purple-900/50 to-blue-900/50 rounded-lg border border-purple-500/50">
                  <h4 className="text-sm font-semibold text-purple-300 mb-2 flex items-center gap-2">
                    🎯 Radial Menu Active
                  </h4>
                  <div className="text-center">
                    <div className="text-3xl mb-2">
                      {getSelectedMenuItem(hand.gesture.rotation.roll)?.icon}
                    </div>
                    <div className="text-white font-bold text-lg">
                      {getSelectedMenuItem(hand.gesture.rotation.roll)?.name}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      Rotate wrist to change selection
                    </div>
                  </div>
                </div>
              )}

              {/* Pinch Status */}
              <div className="mb-4">
                <h4 className="text-sm font-semibold text-gray-400 mb-2">Pinch Detection</h4>
                {hand.gesture.pinches.length === 0 ? (
                  <div className="text-gray-600 text-xs">No pinches detected</div>
                ) : (
                  <div className="space-y-2">
                    {hand.gesture.pinches.map((pinch, i) => (
                      <div key={i} className="bg-gray-900/50 rounded p-2">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-white text-sm font-medium">
                            {pinch.fingers.join(' + ')}
                          </span>
                          <span className="text-xs text-gray-400">
                            {(pinch.strength * 100).toFixed(0)}%
                          </span>
                        </div>
                        <div className="w-full bg-gray-700 h-2 rounded-full overflow-hidden">
                          <div
                            className="h-full transition-all"
                            style={{
                              width: `${pinch.strength * 100}%`,
                              backgroundColor: hand.handedness === 'Right' ? '#00ff00' : '#ff0000'
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Rotation Values */}
              <div className="mb-4">
                <h4 className="text-sm font-semibold text-gray-400 mb-2">Rotation (Degrees)</h4>
                <div className="space-y-2">
                  <div className="bg-gray-900/50 rounded p-2">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-white text-sm">Roll (Twist)</span>
                      <span className="font-mono text-sm text-white">
                        {hand.gesture.rotation.roll.toFixed(1)}°
                      </span>
                    </div>
                    <div className="w-full bg-gray-700 h-2 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 transition-all"
                        style={{
                          width: `${Math.abs(hand.gesture.rotation.roll / 180) * 100}%`
                        }}
                      />
                    </div>
                  </div>

                  <div className="bg-gray-900/50 rounded p-2">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-white text-sm">Pitch (Tilt)</span>
                      <span className="font-mono text-sm text-white">
                        {hand.gesture.rotation.pitch.toFixed(1)}°
                      </span>
                    </div>
                    <div className="w-full bg-gray-700 h-2 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-purple-500 transition-all"
                        style={{
                          width: `${Math.abs(hand.gesture.rotation.pitch / 180) * 100}%`
                        }}
                      />
                    </div>
                  </div>

                  <div className="bg-gray-900/50 rounded p-2">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-white text-sm">Yaw (Turn)</span>
                      <span className="font-mono text-sm text-white">
                        {hand.gesture.rotation.yaw.toFixed(1)}°
                      </span>
                    </div>
                    <div className="w-full bg-gray-700 h-2 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-yellow-500 transition-all"
                        style={{
                          width: `${Math.abs(hand.gesture.rotation.yaw / 180) * 100}%`
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Slider Values */}
              <div className="mb-4">
                <h4 className="text-sm font-semibold text-gray-400 mb-2">Slider Values (0-100)</h4>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Roll Slider:</span>
                    <span className="font-mono text-white">
                      {rotationToSliderValue(hand.gesture.rotation.roll).toFixed(0)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Pitch Slider:</span>
                    <span className="font-mono text-white">
                      {rotationToSliderValue(hand.gesture.rotation.pitch).toFixed(0)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Yaw Slider:</span>
                    <span className="font-mono text-white">
                      {rotationToSliderValue(hand.gesture.rotation.yaw).toFixed(0)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Finger States */}
              <div>
                <h4 className="text-sm font-semibold text-gray-400 mb-2">Finger States</h4>
                <div className="grid grid-cols-5 gap-1">
                  {Object.entries(hand.gesture.fingerStates).map(([finger, extended]) => (
                    <div
                      key={finger}
                      className={`text-center py-2 rounded text-xs font-semibold ${
                        extended
                          ? 'bg-green-600 text-white'
                          : 'bg-gray-700 text-gray-500'
                      }`}
                    >
                      {finger.charAt(0).toUpperCase()}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}

          {hands.length === 0 && !isLoading && (
            <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-8 text-center border border-gray-700">
              <p className="text-gray-400 mb-2">No hands detected</p>
              <p className="text-xs text-gray-600">Show your hand(s) to the camera</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
