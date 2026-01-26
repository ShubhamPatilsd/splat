'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  analyzeGesture,
  GestureState,
  normalizeToScreen,
  rotationToSliderValue,
  Landmark,
  HandLandmark,
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

// Radial menu configuration
// Just set the total angle range and menu items - segments are auto-calculated!
const MENU_START_ANGLE = -125;  // Start angle for entire menu (degrees)
const MENU_END_ANGLE = 10;      // End angle for entire menu (degrees)
const SENSITIVITY = 1.5;         // Rotation sensitivity multiplier (higher = more sensitive)

const menuItemsConfig = [
  { name: 'Pen', icon: '🖊️', color: '#3B82F6' },
  { name: 'Pencil', icon: '✏️', color: '#10B981' },
  { name: 'Brush', icon: '🖌️', color: '#F59E0B' },
  { name: 'Eraser', icon: '🧹', color: '#EF4444' },
];

// Automatically divide the range into equal segments
const totalRange = MENU_END_ANGLE - MENU_START_ANGLE;
const segmentSize = totalRange / menuItemsConfig.length;

const menuItems: MenuItem[] = menuItemsConfig.map((item, index) => ({
  ...item,
  startAngle: MENU_START_ANGLE + (segmentSize * index),
  endAngle: MENU_START_ANGLE + (segmentSize * (index + 1)),
}));

// Get selected menu item based on finger angle
const getSelectedMenuItem = (fingerAngle: number): MenuItem | null => {
  // Find which menu item range the finger angle falls into
  for (const item of menuItems) {
    if (fingerAngle >= item.startAngle && fingerAngle < item.endAngle) {
      return item;
    }
  }

  return menuItems[1]; // Default to Pencil if out of range
};

export default function GestureTracker() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hands, setHands] = useState<HandData[]>([]);
  const [gestureCombos, setGestureCombos] = useState<GestureCombo[]>([]);
  const [splatActive, setSplatActive] = useState(false);
  const prevSplatStateRef = useRef(false);
  const splatCooldownRef = useRef(false);

  // Track selected brush tool from radial menu
  const [selectedTool, setSelectedTool] = useState<string>('Pencil');
  const prevLeftPinchRef = useRef(false);
  const hoveredToolRef = useRef<string>('Pencil'); // Track what tool is being hovered

  // Track hand sizes for splat detection (detecting hands moving closer)
  const handSizeHistoryRef = useRef<{ left: number[]; right: number[] }>({ left: [], right: [] });
  const SPLAT_SIZE_INCREASE_THRESHOLD = 0.015; // Minimum size increase to count as "moving closer"
  const SPLAT_HISTORY_LENGTH = 5; // Number of frames to track for velocity

  // Drawing mode state
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [currentColor, setCurrentColor] = useState('#FF0000'); // Default red
  const [lockedColor, setLockedColor] = useState('#FF0000'); // Color locked in by left hand pinch
  const isDrawingModeRef = useRef(false);
  const currentColorRef = useRef('#FF0000');
  const drawingStrokesRef = useRef<Array<{ x: number, y: number, color: string }[]>>([]);
  const currentStrokeRef = useRef<{ x: number, y: number, color: string }[]>([]);
  const isPinchingRef = useRef(false);
  const prevLeftHandPinchRef = useRef(false);

  // Sync refs with state - use locked color for drawing
  isDrawingModeRef.current = isDrawingMode;
  currentColorRef.current = lockedColor; // Use locked color for actual drawing

  // Detect gesture combinations
  const detectGestureCombos = useCallback((handData: HandData[]) => {
    const combos: GestureCombo[] = [];

    handData.forEach((hand) => {
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

      // SPLAT GESTURE: Both hands open with palms facing camera AND moving closer simultaneously

      // Determine which hand is left/right
      const leftHand = hand1.handedness === 'Left' ? hand1 : hand2;
      const rightHand = hand1.handedness === 'Right' ? hand1 : hand2;

      // Track hand size history
      handSizeHistoryRef.current.left.push(leftHand.gesture.handSize);
      handSizeHistoryRef.current.right.push(rightHand.gesture.handSize);

      // Keep only recent history
      if (handSizeHistoryRef.current.left.length > SPLAT_HISTORY_LENGTH) {
        handSizeHistoryRef.current.left.shift();
      }
      if (handSizeHistoryRef.current.right.length > SPLAT_HISTORY_LENGTH) {
        handSizeHistoryRef.current.right.shift();
      }

      // Calculate if hands are getting bigger (moving closer to camera)
      const leftHistory = handSizeHistoryRef.current.left;
      const rightHistory = handSizeHistoryRef.current.right;

      let leftGettingBigger = false;
      let rightGettingBigger = false;

      if (leftHistory.length >= 3) {
        const leftSizeChange = leftHistory[leftHistory.length - 1] - leftHistory[0];
        leftGettingBigger = leftSizeChange > SPLAT_SIZE_INCREASE_THRESHOLD;
      }

      if (rightHistory.length >= 3) {
        const rightSizeChange = rightHistory[rightHistory.length - 1] - rightHistory[0];
        rightGettingBigger = rightSizeChange > SPLAT_SIZE_INCREASE_THRESHOLD;
      }

      // Check splat conditions: both hands open, palms forward, AND both getting bigger
      const isSplatPose = hand1.gesture.isOpen && hand2.gesture.isOpen &&
        hand1.gesture.isPalmFacingCamera && hand2.gesture.isPalmFacingCamera;
      const handsMovingCloser = leftGettingBigger && rightGettingBigger;

      // Detect onset (transition from not-splat to splat) with cooldown
      if (isSplatPose && handsMovingCloser && !prevSplatStateRef.current && !splatCooldownRef.current) {
        // Trigger splat!
        setSplatActive(true);
        splatCooldownRef.current = true;

        // Clear size history after splat to require new forward motion
        handSizeHistoryRef.current.left = [];
        handSizeHistoryRef.current.right = [];

        // Reset splat visual after animation
        setTimeout(() => {
          setSplatActive(false);
        }, 500);

        // Cooldown to prevent rapid re-triggering
        setTimeout(() => {
          splatCooldownRef.current = false;
        }, 800);

        combos.push({
          name: 'SPLAT! 💥',
          active: true,
          timestamp: Date.now()
        });
      }

      prevSplatStateRef.current = isSplatPose && handsMovingCloser;
    } else {
      // Reset splat state when not detecting 2 hands
      prevSplatStateRef.current = false;
      handSizeHistoryRef.current = { left: [], right: [] };
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
            let rightHandDrawingData: { pinch: any, position: { x: number, y: number } } | null = null;

            for (let i = 0; i < results.multiHandLandmarks.length; i++) {
              const landmarks: Landmark[] = results.multiHandLandmarks[i];
              const handedness = results.multiHandedness[i];
              const isRightHand = handedness.label === 'Right';

              const gesture = analyzeGesture(landmarks);
              detectedHands.push({ gesture, handedness: handedness.label });

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

              // CAPTURE RIGHT HAND DATA FOR DRAWING (Processed after loop)
              if (isDrawingModeRef.current && isRightHand) {
                const thumbIndexPinch = gesture.pinches.find(
                  p => p.fingers.includes('thumb') && p.fingers.includes('index')
                );

                if (thumbIndexPinch) {
                  const screenPos = normalizeToScreen(
                    thumbIndexPinch.position,
                    canvas.width,
                    canvas.height
                  );
                  rightHandDrawingData = { pinch: thumbIndexPinch, position: screenPos };
                }
              }

              // LEFT HAND COLOR PICKER in DRAWING MODE
              if (!isRightHand && isDrawingModeRef.current) {
                const palmPos = normalizeToScreen(
                  gesture.palmCenter,
                  canvas.width,
                  canvas.height
                );

                // Use hand rotation to automatically change hue (0-360 degrees)
                // Map rotation angle to hue (normalize -180 to 180 → 0 to 360)
                const hue = ((gesture.rotation.roll + 180) % 360);
                const currentHueColor = `hsl(${hue}, 100%, 50%)`;

                // Update current color as hand rotates
                // setCurrentColor(currentHueColor); // DISABLED: User wants tap-to-select behavior
                // The currentHueColor will be used for PREVIEW (visuals), but not for drawing until pinned.

                // Draw smooth continuous hue wheel ring
                const wheelRadius = 80;
                const segments = 60; // optimize rendering
                for (let i = 0; i < segments; i++) {
                  const startAngle = (i / segments) * Math.PI * 2;
                  const endAngle = ((i + 1) / segments) * Math.PI * 2;
                  // Ensure the wheel aligns with the rotation logic
                  // Hue logic was: ((gesture.rotation.roll + 180) % 360) where roll is -180 to 180
                  // So top (-90 deg or -PI/2) should be 0 hue (Red) to match?
                  // Actually let's just draw the full variety
                  const segmentHue = (i / segments) * 360;

                  ctx.beginPath();
                  ctx.arc(palmPos.x, palmPos.y, wheelRadius, startAngle, endAngle);
                  ctx.arc(palmPos.x, palmPos.y, wheelRadius - 10, endAngle, startAngle, true);
                  ctx.fillStyle = `hsl(${segmentHue}, 100%, 50%)`;
                  ctx.fill();
                }

                // Draw large color indicator on palm
                const indicatorRadius = 60;

                // Outer ring showing current hue
                ctx.beginPath();
                ctx.arc(palmPos.x, palmPos.y, indicatorRadius, 0, 2 * Math.PI);
                ctx.fillStyle = currentHueColor;
                ctx.fill();
                ctx.strokeStyle = '#FFFFFF';
                ctx.lineWidth = 4;
                ctx.stroke();

                // Inner circle showing locked color (if different)
                if (lockedColor !== currentHueColor) {
                  ctx.beginPath();
                  ctx.arc(palmPos.x, palmPos.y, indicatorRadius * 0.5, 0, 2 * Math.PI);
                  ctx.fillStyle = lockedColor;
                  ctx.fill();
                  ctx.strokeStyle = '#FFFFFF';
                  ctx.lineWidth = 2;
                  ctx.stroke();
                }

                // Show hue value
                ctx.font = 'bold 14px sans-serif';
                ctx.fillStyle = '#000000';
                ctx.strokeStyle = '#FFFFFF';
                ctx.lineWidth = 3;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.strokeText(`${Math.round(hue)}°`, palmPos.x, palmPos.y);
                ctx.fillText(`${Math.round(hue)}°`, palmPos.x, palmPos.y);

                // Detect left hand pinch to lock in color
                const leftHandPinch = gesture.pinches.find(
                  p => p.fingers.includes('thumb') && p.fingers.includes('index')
                );

                if (leftHandPinch && leftHandPinch.strength > 0.5) {
                  if (!prevLeftHandPinchRef.current) {
                    // Pinch started - lock in current color
                    setLockedColor(currentHueColor);
                    setCurrentColor(currentHueColor); // Update the active drawing color ONLY on pinch
                    prevLeftHandPinchRef.current = true;

                    // Visual feedback
                    ctx.beginPath();
                    ctx.arc(palmPos.x, palmPos.y, indicatorRadius + 20, 0, 2 * Math.PI);
                    ctx.strokeStyle = '#00FF00';
                    ctx.lineWidth = 6;
                    ctx.stroke();

                    ctx.font = 'bold 16px sans-serif';
                    ctx.fillStyle = '#00FF00';
                    ctx.strokeStyle = '#000000';
                    ctx.lineWidth = 3;
                    ctx.strokeText('LOCKED', palmPos.x, palmPos.y + indicatorRadius + 35);
                    ctx.fillText('LOCKED', palmPos.x, palmPos.y + indicatorRadius + 35);
                  }
                } else {
                  prevLeftHandPinchRef.current = false;
                }

                // Instruction text
                ctx.font = '12px sans-serif';
                ctx.fillStyle = '#FFFFFF';
                ctx.strokeStyle = '#000000';
                ctx.lineWidth = 2;
                ctx.strokeText('Rotate hand to change hue', palmPos.x, palmPos.y - indicatorRadius - 20);
                ctx.fillText('Rotate hand to change hue', palmPos.x, palmPos.y - indicatorRadius - 20);
                ctx.strokeText('Pinch to lock color', palmPos.x, palmPos.y + indicatorRadius + 20);
                ctx.fillText('Pinch to lock color', palmPos.x, palmPos.y + indicatorRadius + 20);
              }

              // Left hand: detect pinch to select tool (when NOT in drawing mode)
              if (!isRightHand && !isDrawingModeRef.current) {
                // Check for thumb+index pinch
                const hasThumbIndexPinch = gesture.pinches.some(
                  p => p.fingers.includes('thumb') && p.fingers.includes('index') && p.strength > 0.7
                );

                // Detect pinch onset (transition from not pinching to pinching)
                if (hasThumbIndexPinch && !prevLeftPinchRef.current) {
                  // Select the currently hovered tool
                  setSelectedTool(hoveredToolRef.current);
                }
                prevLeftPinchRef.current = hasThumbIndexPinch;
              }

              // Draw radial menu for LEFT HAND when palm area is large enough (NOT in drawing mode)
              // This allows menu to stay open during pinch (palm stays visible)
              const MIN_PALM_AREA = 0.002; // Minimum palm area to show menu
              const showMenu = !isRightHand && gesture.palmArea > MIN_PALM_AREA && !isDrawingModeRef.current;

              if (showMenu) {
                const palmPos = normalizeToScreen(
                  gesture.palmCenter,
                  canvas.width,
                  canvas.height
                );

                // Calculate middle finger angle from landmarks (screen space)
                const middleTip = landmarks[HandLandmark.MIDDLE_FINGER_TIP];
                const middleTipScreen = normalizeToScreen(
                  { x: middleTip.x, y: middleTip.y },
                  canvas.width,
                  canvas.height
                );
                const dx = middleTipScreen.x - palmPos.x;
                const dy = middleTipScreen.y - palmPos.y;
                const middleFingerAngle = Math.atan2(dy, dx) * (180 / Math.PI); // Convert to degrees

                const menuRadius = 120;
                const innerRadius = 40;
                const hoveredItem = getSelectedMenuItem(middleFingerAngle);

                // Update hovered tool ref for pinch selection
                if (hoveredItem) {
                  hoveredToolRef.current = hoveredItem.name;
                }

                // Draw menu segments
                menuItems.forEach((item) => {
                  // Draw at actual angles (no offset)
                  const startAngle = item.startAngle * Math.PI / 180;
                  const endAngle = item.endAngle * Math.PI / 180;
                  const isHovered = hoveredItem?.name === item.name;
                  const isLockedIn = selectedTool === item.name;

                  // Draw segment
                  ctx.beginPath();
                  ctx.arc(palmPos.x, palmPos.y, menuRadius, startAngle, endAngle);
                  ctx.arc(palmPos.x, palmPos.y, innerRadius, endAngle, startAngle, true);
                  ctx.closePath();

                  // Fill with color (brighter if hovered, even brighter if locked in)
                  if (isLockedIn) {
                    ctx.fillStyle = item.color; // Full color for locked-in tool
                  } else if (isHovered) {
                    ctx.fillStyle = item.color + 'CC'; // 80% opacity for hovered
                  } else {
                    ctx.fillStyle = item.color + '60'; // 40% opacity for others
                  }
                  ctx.fill();

                  // Outline - thick white for locked-in, medium for hovered
                  if (isLockedIn) {
                    ctx.strokeStyle = '#00FF00'; // Green outline for locked-in
                    ctx.lineWidth = 4;
                  } else if (isHovered) {
                    ctx.strokeStyle = '#FFFFFF';
                    ctx.lineWidth = 2;
                  } else {
                    ctx.strokeStyle = '#FFFFFF40';
                    ctx.lineWidth = 1;
                  }
                  ctx.stroke();

                  // Draw icon at actual angle (no offset)
                  const midAngleDeg = (item.startAngle + item.endAngle) / 2;
                  const midAngle = midAngleDeg * Math.PI / 180;
                  const iconRadius = (menuRadius + innerRadius) / 2;
                  const iconX = palmPos.x + Math.cos(midAngle) * iconRadius;
                  const iconY = palmPos.y + Math.sin(midAngle) * iconRadius;

                  ctx.font = (isHovered || isLockedIn) ? 'bold 24px sans-serif' : '20px sans-serif';
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'middle';
                  ctx.fillStyle = '#FFFFFF';
                  ctx.fillText(item.icon, iconX, iconY);
                });

                // Draw disabled zone (area outside the menu range)
                const disabledStartAngle = MENU_END_ANGLE * Math.PI / 180;
                const disabledEndAngle = (MENU_START_ANGLE + 360) * Math.PI / 180;
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

                // Draw center info - show locked-in tool and hovered tool
                ctx.font = 'bold 11px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                // Show locked-in tool
                ctx.fillStyle = '#00FF00';
                ctx.fillText(selectedTool, palmPos.x, palmPos.y - 10);

                // Show hovered tool (if different from locked-in)
                if (hoveredItem && hoveredItem.name !== selectedTool) {
                  ctx.fillStyle = '#FFFFFF';
                  ctx.font = '9px sans-serif';
                  ctx.fillText(`→ ${hoveredItem.name}`, palmPos.x, palmPos.y + 6);
                }

                // Hint text
                ctx.font = '7px sans-serif';
                ctx.fillStyle = '#888888';
                ctx.fillText('pinch to select', palmPos.x, palmPos.y + 18);

                // Draw indicator line pointing to middle finger (same angle as selection)
                const lineAngle = middleFingerAngle * Math.PI / 180;

                const lineStartX = palmPos.x + Math.cos(lineAngle) * innerRadius;
                const lineStartY = palmPos.y + Math.sin(lineAngle) * innerRadius;
                const lineEndX = palmPos.x + Math.cos(lineAngle) * menuRadius;
                const lineEndY = palmPos.y + Math.sin(lineAngle) * menuRadius;

                ctx.beginPath();
                ctx.moveTo(lineStartX, lineStartY);
                ctx.lineTo(lineEndX, lineEndY);
                ctx.strokeStyle = '#FFFF00';
                ctx.lineWidth = 3;
                ctx.stroke();
              }
            }

            // PROCESS DRAWING LOGIC (Once per frame)
            if (isDrawingModeRef.current) {
              if (rightHandDrawingData) {
                const { pinch, position: screenPos } = rightHandDrawingData;
                const circleRadius = 20 + (pinch.strength * 15);

                // Render cursor
                ctx.beginPath();
                ctx.arc(screenPos.x, screenPos.y, circleRadius, 0, 2 * Math.PI);
                ctx.strokeStyle = currentColorRef.current;
                ctx.lineWidth = 5;
                ctx.stroke();

                ctx.beginPath();
                ctx.arc(screenPos.x, screenPos.y, 8, 0, 2 * Math.PI);
                ctx.fillStyle = currentColorRef.current;
                ctx.fill();

                // Start/Continue Stroke
                if (!isPinchingRef.current) {
                  isPinchingRef.current = true;
                  currentStrokeRef.current = [{ x: screenPos.x, y: screenPos.y, color: currentColorRef.current }];
                } else {
                  currentStrokeRef.current.push({ x: screenPos.x, y: screenPos.y, color: currentColorRef.current });
                }

                ctx.font = 'bold 16px sans-serif';
                ctx.fillStyle = '#FFFFFF';
                ctx.strokeStyle = '#000000';
                ctx.lineWidth = 4;
                ctx.strokeText('DRAWING', screenPos.x, screenPos.y - 40);
                ctx.fillText('DRAWING', screenPos.x, screenPos.y - 40);

              } else {
                // Right hand not pinching or not present -> End stroke if active
                if (isPinchingRef.current) {
                  isPinchingRef.current = false;
                  if (currentStrokeRef.current.length > 1) {
                    drawingStrokesRef.current = [...drawingStrokesRef.current, currentStrokeRef.current];
                  }
                  currentStrokeRef.current = [];
                }
              }
            } else {
              // Not in drawing mode -> End stroke if active
              if (isPinchingRef.current) {
                isPinchingRef.current = false;
                if (currentStrokeRef.current.length > 1) {
                  drawingStrokesRef.current = [...drawingStrokesRef.current, currentStrokeRef.current];
                }
                currentStrokeRef.current = [];
              }
            }

            setHands(detectedHands);
            detectGestureCombos(detectedHands);
          } else {
            setHands([]);
            setGestureCombos([]);
          }

          // Draw existing strokes ON TOP of everything (after video and hands)
          drawingStrokesRef.current.forEach(stroke => {
            if (stroke.length < 2) return;
            ctx.beginPath();
            ctx.moveTo(stroke[0].x, stroke[0].y);
            for (let i = 1; i < stroke.length; i++) {
              ctx.lineTo(stroke[i].x, stroke[i].y);
            }
            ctx.strokeStyle = stroke[0].color;
            ctx.lineWidth = 8;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.stroke();
          });

          // Draw current stroke being drawn
          if (currentStrokeRef.current.length > 1) {
            const stroke = currentStrokeRef.current;
            ctx.beginPath();
            ctx.moveTo(stroke[0].x, stroke[0].y);
            for (let i = 1; i < stroke.length; i++) {
              ctx.lineTo(stroke[i].x, stroke[i].y);
            }
            ctx.strokeStyle = stroke[0].color;
            ctx.lineWidth = 8;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.stroke();
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
            <p className="text-sm text-gray-400">
              {isDrawingMode ? '🎨 Drawing Mode - Pinch to draw, left hand for color picker' : 'Real-time hand gesture detection and combinations'}
            </p>
          </div>
          <div className="flex items-center gap-4">
            {/* Drawing Mode Toggle */}
            <button
              onClick={() => setIsDrawingMode(!isDrawingMode)}
              className={`px-4 py-2 rounded-lg font-semibold transition-colors ${isDrawingMode
                ? 'bg-purple-600 hover:bg-purple-700 text-white'
                : 'bg-gray-700 hover:bg-gray-600 text-white'
                }`}
            >
              {isDrawingMode ? '🎨 Drawing Mode' : '👋 Gesture Mode'}
            </button>

            {/* Clear Canvas Button (only in drawing mode) */}
            {isDrawingMode && (
              <button
                onClick={() => {
                  drawingStrokesRef.current = [];
                  currentStrokeRef.current = [];
                  isPinchingRef.current = false;
                }}
                className="px-4 py-2 rounded-lg font-semibold bg-red-600 hover:bg-red-700 text-white transition-colors"
              >
                🗑️ Clear Canvas
              </button>
            )}

            {/* Selected Tool Display */}
            <div className="text-center">
              <div className="text-sm text-gray-400">Selected Tool</div>
              <div className="text-2xl font-bold text-green-400">
                {menuItemsConfig.find(m => m.name === selectedTool)?.icon} {selectedTool}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm text-gray-400">Hands Detected</div>
              <div className="text-3xl font-bold text-white">{hands.length}</div>
            </div>
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

      {/* SPLAT Visual Feedback */}
      {splatActive && (
        <div className="absolute inset-0 z-40 pointer-events-none flex items-center justify-center animate-splat-flash">
          <div className="text-center">
            <div className="text-9xl font-black text-white drop-shadow-[0_0_60px_rgba(255,255,0,1)] animate-splat-scale">
              SPLAT!
            </div>
            <div className="text-6xl mt-4">💥✋✋💥</div>
          </div>
          <div className="absolute inset-0 bg-gradient-radial from-yellow-400/40 via-orange-500/20 to-transparent animate-splat-ring" />
        </div>
      )}

      <style jsx>{`
        @keyframes splat-flash {
          0% { background-color: rgba(255, 255, 0, 0.3); }
          100% { background-color: transparent; }
        }
        @keyframes splat-scale {
          0% { transform: scale(0.5); opacity: 0; }
          50% { transform: scale(1.2); opacity: 1; }
          100% { transform: scale(1); opacity: 0; }
        }
        @keyframes splat-ring {
          0% { transform: scale(0.5); opacity: 0.8; }
          100% { transform: scale(2); opacity: 0; }
        }
        .animate-splat-flash {
          animation: splat-flash 0.5s ease-out forwards;
        }
        .animate-splat-scale {
          animation: splat-scale 0.5s ease-out forwards;
        }
        .animate-splat-ring {
          animation: splat-ring 0.5s ease-out forwards;
        }
      `}</style>

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

            {/* Gesture Instructions */}
            <div className="mt-3 pt-3 border-t border-gray-700">
              <div className="text-xs text-gray-400 space-y-1">
                {isDrawingMode ? (
                  <>
                    <p className="font-semibold text-purple-400 mb-2">🎨 Drawing Mode Instructions:</p>
                    <p>• <span className="text-green-400 font-semibold">RIGHT HAND</span>: Bring thumb + index together</p>
                    <p>• Yellow circle with "PINCH" appears when fingers are close</p>
                    <p>• Pinch slightly tighter to draw (White circle + "DRAWING")</p>
                    <p>• Move hand while pinching - line follows continuously</p>
                    <p>• <span className="text-red-400 font-semibold">LEFT HAND</span>: Rotate hand to browse color wheel</p>
                    <p>• <span className="text-yellow-400 font-semibold">Pinch left hand to LOCK</span> the selected color</p>
                    <p>• Current brush color is shown in the center circle</p>
                    <p>• Click <span className="text-red-400 font-semibold">"Clear Canvas"</span> to erase all strokes</p>
                  </>
                ) : (
                  <>
                    <p className="font-semibold text-yellow-400 mb-2">💥 SPLAT Gesture:</p>
                    <p>• Show <span className="text-white font-semibold">BOTH HANDS</span> with open palms facing the camera</p>
                    <p>• Quick, simultaneous motion - like pushing or saying "stop!"</p>
                    <p>• Look for the <span className="text-yellow-400">PALM FORWARD</span> badge on each hand</p>

                    <p className="font-semibold text-purple-400 mt-3 mb-2">🎯 Radial Menu Controls:</p>
                    <p>• Show your <span className="text-red-400 font-semibold">LEFT HAND</span> with palm open (all fingers spread)</p>
                    <p>• Radial menu appears on your palm center ({Math.round(MENU_END_ANGLE - MENU_START_ANGLE)}° range, {menuItemsConfig.length} segments)</p>
                    <p>• <span className="text-yellow-400 font-semibold">Point your middle finger</span> to hover over tools</p>
                    <p>• <span className="text-green-400 font-semibold">Pinch (thumb + index)</span> to lock in the hovered tool</p>
                    <p>• <span className="text-blue-400">🖊️ Pen</span> → <span className="text-green-400">✏️ Pencil</span> → <span className="text-orange-400">🖌️ Brush</span> → <span className="text-red-400">🧹 Eraser</span></p>
                  </>
                )}
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
                <div className="flex gap-2 flex-wrap">
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
                  {hand.gesture.isPalmFacingCamera && (
                    <span className="px-2 py-1 bg-yellow-600 rounded text-xs font-semibold text-white">
                      PALM FORWARD
                    </span>
                  )}
                  <span className="px-2 py-1 bg-gray-700 rounded text-xs font-mono text-gray-300">
                    Palm: {(hand.gesture.palmArea * 1000).toFixed(1)}
                  </span>
                </div>
              </div>

              {/* Radial Menu Selection - Only for Left Hand when palm area is large enough */}
              {hand.handedness === 'Left' && hand.gesture.palmArea > 0.002 && (
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
                <h4 className="text-sm font-semibold text-gray-400 mb-2">Rotation (Middle Finger)</h4>
                <div className="space-y-2">
                  <div className="bg-gray-900/50 rounded p-2">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-white text-sm">Roll (Twist)</span>
                      <div className="flex flex-col items-end">
                        <span className="font-mono text-sm text-white">
                          {hand.gesture.rotation.roll.toFixed(1)}°
                        </span>
                        <span className="font-mono text-xs text-yellow-400">
                          {(hand.gesture.rotation.roll * SENSITIVITY).toFixed(1)}° (×{SENSITIVITY})
                        </span>
                      </div>
                    </div>
                    <div className="w-full bg-gray-700 h-2 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 transition-all"
                        style={{
                          width: `${Math.abs((hand.gesture.rotation.roll * SENSITIVITY) / 180) * 100}%`
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
                    <span className="text-gray-400">Roll Slider (×{SENSITIVITY}):</span>
                    <span className="font-mono text-white">
                      {rotationToSliderValue(hand.gesture.rotation.roll * SENSITIVITY).toFixed(0)}
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
                      className={`text-center py-2 rounded text-xs font-semibold ${extended
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
