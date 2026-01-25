// MediaPipe Hand Landmarks (21 points per hand)
export enum HandLandmark {
  WRIST = 0,
  THUMB_CMC = 1,
  THUMB_MCP = 2,
  THUMB_IP = 3,
  THUMB_TIP = 4,
  INDEX_FINGER_MCP = 5,
  INDEX_FINGER_PIP = 6,
  INDEX_FINGER_DIP = 7,
  INDEX_FINGER_TIP = 8,
  MIDDLE_FINGER_MCP = 9,
  MIDDLE_FINGER_PIP = 10,
  MIDDLE_FINGER_DIP = 11,
  MIDDLE_FINGER_TIP = 12,
  RING_FINGER_MCP = 13,
  RING_FINGER_PIP = 14,
  RING_FINGER_DIP = 15,
  RING_FINGER_TIP = 16,
  PINKY_MCP = 17,
  PINKY_PIP = 18,
  PINKY_DIP = 19,
  PINKY_TIP = 20,
}

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export interface PinchGesture {
  isPinching: boolean;
  fingers: string[]; // e.g., ['thumb', 'index']
  strength: number; // 0-1, how close the fingers are
  position: { x: number; y: number }; // midpoint between pinched fingers
}

export interface HandRotation {
  roll: number;  // rotation around z-axis (twisting)
  pitch: number; // rotation around x-axis (tilting forward/back)
  yaw: number;   // rotation around y-axis (turning left/right)
}

export interface GestureState {
  pinches: PinchGesture[];
  rotation: HandRotation;
  palmCenter: { x: number; y: number };
  isOpen: boolean; // all fingers extended
  isFist: boolean; // all fingers closed
  fingerStates: {
    thumb: boolean;
    index: boolean;
    middle: boolean;
    ring: boolean;
    pinky: boolean;
  };
}

/**
 * Calculate Euclidean distance between two landmarks
 */
export function distance(a: Landmark, b: Landmark): number {
  return Math.sqrt(
    Math.pow(a.x - b.x, 2) +
    Math.pow(a.y - b.y, 2) +
    Math.pow(a.z - b.z, 2)
  );
}

/**
 * Calculate 2D distance (ignoring z-axis)
 */
export function distance2D(a: Landmark, b: Landmark): number {
  return Math.sqrt(
    Math.pow(a.x - b.x, 2) +
    Math.pow(a.y - b.y, 2)
  );
}

/**
 * Detect if two fingers are pinching together
 */
export function detectPinch(
  landmarks: Landmark[],
  finger1: HandLandmark,
  finger2: HandLandmark,
  threshold: number = 0.05
): PinchGesture {
  const tip1 = landmarks[finger1];
  const tip2 = landmarks[finger2];

  const dist = distance(tip1, tip2);
  const isPinching = dist < threshold;

  // Calculate pinch strength (inverse of distance, normalized)
  const strength = Math.max(0, Math.min(1, 1 - (dist / threshold)));

  // Midpoint between fingers
  const position = {
    x: (tip1.x + tip2.x) / 2,
    y: (tip1.y + tip2.y) / 2,
  };

  return {
    isPinching,
    fingers: [getLandmarkName(finger1), getLandmarkName(finger2)],
    strength,
    position,
  };
}

/**
 * Get all active pinch gestures
 */
export function detectAllPinches(landmarks: Landmark[]): PinchGesture[] {
  const pinches: PinchGesture[] = [];

  const fingerTips = [
    { name: 'thumb', landmark: HandLandmark.THUMB_TIP },
    { name: 'index', landmark: HandLandmark.INDEX_FINGER_TIP },
    { name: 'middle', landmark: HandLandmark.MIDDLE_FINGER_TIP },
    { name: 'ring', landmark: HandLandmark.RING_FINGER_TIP },
    { name: 'pinky', landmark: HandLandmark.PINKY_TIP },
  ];

  // Check thumb against all other fingers
  for (let i = 1; i < fingerTips.length; i++) {
    const pinch = detectPinch(
      landmarks,
      HandLandmark.THUMB_TIP,
      fingerTips[i].landmark
    );

    if (pinch.isPinching) {
      pinches.push(pinch);
    }
  }

  // Check other finger combinations (optional - uncomment if needed)
  // for (let i = 1; i < fingerTips.length; i++) {
  //   for (let j = i + 1; j < fingerTips.length; j++) {
  //     const pinch = detectPinch(landmarks, fingerTips[i].landmark, fingerTips[j].landmark);
  //     if (pinch.isPinching) {
  //       pinches.push(pinch);
  //     }
  //   }
  // }

  return pinches;
}

/**
 * Calculate hand rotation based on landmarks
 */
export function calculateHandRotation(landmarks: Landmark[]): HandRotation {
  const wrist = landmarks[HandLandmark.WRIST];
  const indexMCP = landmarks[HandLandmark.INDEX_FINGER_MCP];
  const pinkyMCP = landmarks[HandLandmark.PINKY_MCP];
  const middleMCP = landmarks[HandLandmark.MIDDLE_FINGER_MCP];

  // ROLL: Average angle of all fingers from their base to tip
  // This measures wrist rotation/twist more robustly
  const fingers = [
    { base: HandLandmark.THUMB_MCP, tip: HandLandmark.THUMB_TIP },
    { base: HandLandmark.INDEX_FINGER_MCP, tip: HandLandmark.INDEX_FINGER_TIP },
    { base: HandLandmark.MIDDLE_FINGER_MCP, tip: HandLandmark.MIDDLE_FINGER_TIP },
    { base: HandLandmark.RING_FINGER_MCP, tip: HandLandmark.RING_FINGER_TIP },
    { base: HandLandmark.PINKY_MCP, tip: HandLandmark.PINKY_TIP },
  ];

  let sumSin = 0;
  let sumCos = 0;

  fingers.forEach(finger => {
    const base = landmarks[finger.base];
    const tip = landmarks[finger.tip];
    const dx = tip.x - base.x;
    const dy = tip.y - base.y;
    const angle = Math.atan2(dy, dx);

    // Use sin/cos averaging to handle angle wraparound correctly
    sumSin += Math.sin(angle);
    sumCos += Math.cos(angle);
  });

  // Average angle using atan2 of averaged sin/cos
  const roll = Math.atan2(sumSin / fingers.length, sumCos / fingers.length);

  // PITCH: Tilt forward/backward
  // Using the angle of wrist to middle knuckle vector
  const pitchDy = middleMCP.y - wrist.y;
  const pitchDz = middleMCP.z - wrist.z;
  const pitch = Math.atan2(pitchDz, Math.abs(pitchDy));

  // YAW: Turn left/right
  // Using the angle of the palm width (pinky to index knuckle)
  const yawDx = indexMCP.x - pinkyMCP.x;
  const yawDz = indexMCP.z - pinkyMCP.z;
  const yaw = Math.atan2(yawDz, yawDx);

  return {
    roll: radToDeg(roll),
    pitch: radToDeg(pitch),
    yaw: radToDeg(yaw),
  };
}

/**
 * Check if a finger is extended
 */
export function isFingerExtended(
  landmarks: Landmark[],
  fingerTip: HandLandmark,
  fingerPIP: HandLandmark,
  wrist: HandLandmark = HandLandmark.WRIST
): boolean {
  const tip = landmarks[fingerTip];
  const pip = landmarks[fingerPIP];
  const wristPoint = landmarks[wrist];

  // Finger is extended if tip is further from wrist than PIP joint
  const tipDist = distance2D(tip, wristPoint);
  const pipDist = distance2D(pip, wristPoint);

  return tipDist > pipDist * 1.1; // 10% tolerance
}

/**
 * Detect finger states (extended or not)
 */
export function detectFingerStates(landmarks: Landmark[]) {
  return {
    thumb: isFingerExtended(landmarks, HandLandmark.THUMB_TIP, HandLandmark.THUMB_IP),
    index: isFingerExtended(landmarks, HandLandmark.INDEX_FINGER_TIP, HandLandmark.INDEX_FINGER_PIP),
    middle: isFingerExtended(landmarks, HandLandmark.MIDDLE_FINGER_TIP, HandLandmark.MIDDLE_FINGER_PIP),
    ring: isFingerExtended(landmarks, HandLandmark.RING_FINGER_TIP, HandLandmark.RING_FINGER_DIP),
    pinky: isFingerExtended(landmarks, HandLandmark.PINKY_TIP, HandLandmark.PINKY_PIP),
  };
}

/**
 * Calculate palm center
 */
export function calculatePalmCenter(landmarks: Landmark[]): { x: number; y: number } {
  const wrist = landmarks[HandLandmark.WRIST];
  const indexMCP = landmarks[HandLandmark.INDEX_FINGER_MCP];
  const pinkyMCP = landmarks[HandLandmark.PINKY_MCP];

  return {
    x: (wrist.x + indexMCP.x + pinkyMCP.x) / 3,
    y: (wrist.y + indexMCP.y + pinkyMCP.y) / 3,
  };
}

/**
 * Analyze complete gesture state for one hand
 */
export function analyzeGesture(landmarks: Landmark[]): GestureState {
  const pinches = detectAllPinches(landmarks);
  const rotation = calculateHandRotation(landmarks);
  const palmCenter = calculatePalmCenter(landmarks);
  const fingerStates = detectFingerStates(landmarks);

  const isOpen = Object.values(fingerStates).every(extended => extended);
  const isFist = Object.values(fingerStates).every(extended => !extended);

  return {
    pinches,
    rotation,
    palmCenter,
    isOpen,
    isFist,
    fingerStates,
  };
}

/**
 * Convert radians to degrees
 */
function radToDeg(rad: number): number {
  return rad * (180 / Math.PI);
}

/**
 * Get human-readable name for landmark
 */
function getLandmarkName(landmark: HandLandmark): string {
  const names: { [key: number]: string } = {
    [HandLandmark.THUMB_TIP]: 'thumb',
    [HandLandmark.INDEX_FINGER_TIP]: 'index',
    [HandLandmark.MIDDLE_FINGER_TIP]: 'middle',
    [HandLandmark.RING_FINGER_TIP]: 'ring',
    [HandLandmark.PINKY_TIP]: 'pinky',
  };
  return names[landmark] || 'unknown';
}

/**
 * Normalize coordinates to screen space (0-1 range to pixel coordinates)
 */
export function normalizeToScreen(
  normalized: { x: number; y: number },
  width: number,
  height: number
): { x: number; y: number } {
  return {
    x: normalized.x * width,
    y: normalized.y * height,
  };
}

/**
 * Map rotation angle to slider value
 * @param angle - rotation angle in degrees (-180 to 180)
 * @param min - minimum slider value
 * @param max - maximum slider value
 */
export function rotationToSliderValue(
  angle: number,
  min: number = 0,
  max: number = 100
): number {
  // Normalize angle to 0-360 range
  const normalized = ((angle + 180) % 360) / 360;
  return min + (normalized * (max - min));
}
