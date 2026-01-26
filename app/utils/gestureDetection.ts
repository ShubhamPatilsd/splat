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
  palmArea: number; // area of palm polygon (normalized, larger = hand closer/more open)
  isOpen: boolean; // all fingers extended
  isFist: boolean; // all fingers closed
  isPalmFacingCamera: boolean; // palm facing toward the camera
  handSize: number; // normalized hand size (larger = closer to camera)
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
  threshold: number = 0.08 // Increased from 0.05 for better sensitivity
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
 * Uses middle finger direction from palm center for visual accuracy
 */
export function calculateHandRotation(landmarks: Landmark[]): HandRotation {
  const wrist = landmarks[HandLandmark.WRIST];
  const indexMCP = landmarks[HandLandmark.INDEX_FINGER_MCP];
  const pinkyMCP = landmarks[HandLandmark.PINKY_MCP];
  const middleMCP = landmarks[HandLandmark.MIDDLE_FINGER_MCP];
  const middleTip = landmarks[HandLandmark.MIDDLE_FINGER_TIP];

  // Calculate palm center
  const palmCenterX = (wrist.x + indexMCP.x + pinkyMCP.x) / 3;
  const palmCenterY = (wrist.y + indexMCP.y + pinkyMCP.y) / 3;

  // ROLL: Direction from palm center to middle finger tip
  // This matches visual perception of where the finger is pointing
  const dx = middleTip.x - palmCenterX;
  const dy = middleTip.y - palmCenterY;
  const roll = Math.atan2(dy, dx);

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
 * Calculate palm area using the shoelace formula
 * Uses the 5 central palm landmarks: WRIST + 4 finger MCPs
 * Returns normalized area (larger = palm more open/closer to camera)
 */
export function calculatePalmArea(landmarks: Landmark[]): number {
  // Get the 5 central palm nodes
  const points = [
    landmarks[HandLandmark.WRIST],
    landmarks[HandLandmark.INDEX_FINGER_MCP],
    landmarks[HandLandmark.MIDDLE_FINGER_MCP],
    landmarks[HandLandmark.RING_FINGER_MCP],
    landmarks[HandLandmark.PINKY_MCP],
  ];

  // Shoelace formula for polygon area
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return Math.abs(area) / 2;
}

/**
 * Detect if palm is facing toward the camera
 * When palm faces camera, the wrist z is larger (further) than fingertip z (closer)
 * Also checks that the hand is relatively flat (not tilted sideways)
 */
export function isPalmFacingCamera(landmarks: Landmark[]): boolean {
  const wrist = landmarks[HandLandmark.WRIST];
  const middleMCP = landmarks[HandLandmark.MIDDLE_FINGER_MCP];
  const middleTip = landmarks[HandLandmark.MIDDLE_FINGER_TIP];
  const indexMCP = landmarks[HandLandmark.INDEX_FINGER_MCP];
  const pinkyMCP = landmarks[HandLandmark.PINKY_MCP];

  // Check 1: Wrist should be further from camera than middle finger MCP
  // (palm facing forward means wrist is pushed back)
  const wristBehindPalm = wrist.z > middleMCP.z - 0.02;

  // Check 2: The palm plane should be roughly perpendicular to camera
  // When palm faces camera, index and pinky MCPs have similar z values
  const palmFlatToCamera = Math.abs(indexMCP.z - pinkyMCP.z) < 0.05;

  // Check 3: Middle fingertip should be closer to camera than wrist when palm faces forward
  const fingersForward = middleTip.z < wrist.z + 0.02;

  return wristBehindPalm && palmFlatToCamera && fingersForward;
}

/**
 * Calculate hand size based on the spread of landmarks
 * Larger value = hand is closer to the camera
 * Uses 2D distance from wrist to fingertips (averages all fingers)
 */
export function calculateHandSize(landmarks: Landmark[]): number {
  const wrist = landmarks[HandLandmark.WRIST];

  const fingerTips = [
    landmarks[HandLandmark.THUMB_TIP],
    landmarks[HandLandmark.INDEX_FINGER_TIP],
    landmarks[HandLandmark.MIDDLE_FINGER_TIP],
    landmarks[HandLandmark.RING_FINGER_TIP],
    landmarks[HandLandmark.PINKY_TIP],
  ];

  // Calculate average 2D distance from wrist to all fingertips
  const totalDistance = fingerTips.reduce((sum, tip) => {
    return sum + distance2D(wrist, tip);
  }, 0);

  return totalDistance / fingerTips.length;
}

/**
 * Analyze complete gesture state for one hand
 */
export function analyzeGesture(landmarks: Landmark[]): GestureState {
  const pinches = detectAllPinches(landmarks);
  const rotation = calculateHandRotation(landmarks);
  const palmCenter = calculatePalmCenter(landmarks);
  const palmArea = calculatePalmArea(landmarks);
  const fingerStates = detectFingerStates(landmarks);
  const handSize = calculateHandSize(landmarks);

  const isOpen = Object.values(fingerStates).every(extended => extended);
  const isFist = Object.values(fingerStates).every(extended => !extended);
  const palmFacingCamera = isPalmFacingCamera(landmarks);

  return {
    pinches,
    rotation,
    palmCenter,
    palmArea,
    isOpen,
    isFist,
    isPalmFacingCamera: palmFacingCamera,
    handSize,
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

/**
 * Knuckle MCP indices (index, middle, ring, pinky - where fingers meet the palm)
 */
const KNUCKLE_MCPS = [
  HandLandmark.INDEX_FINGER_MCP,
  HandLandmark.MIDDLE_FINGER_MCP,
  HandLandmark.RING_FINGER_MCP,
  HandLandmark.PINKY_MCP,
];

/**
 * Detect "knuckles pressed together" - both hands' knuckles (MCP joints) are close in 3D.
 * Used to toggle drawing vs physics mode.
 */
export function detectKnucklesTogetherGesture(
  leftHandLandmarks: Landmark[],
  rightHandLandmarks: Landmark[]
): boolean {
  const leftKnuckles = KNUCKLE_MCPS.map((i) => leftHandLandmarks[i]);
  const rightKnuckles = KNUCKLE_MCPS.map((i) => rightHandLandmarks[i]);

  const leftCx =
    leftKnuckles.reduce((s, p) => s + p.x, 0) / leftKnuckles.length;
  const leftCy =
    leftKnuckles.reduce((s, p) => s + p.y, 0) / leftKnuckles.length;
  const leftCz =
    leftKnuckles.reduce((s, p) => s + p.z, 0) / leftKnuckles.length;
  const rightCx =
    rightKnuckles.reduce((s, p) => s + p.x, 0) / rightKnuckles.length;
  const rightCy =
    rightKnuckles.reduce((s, p) => s + p.y, 0) / rightKnuckles.length;
  const rightCz =
    rightKnuckles.reduce((s, p) => s + p.z, 0) / rightKnuckles.length;

  const leftCenter: Landmark = { x: leftCx, y: leftCy, z: leftCz };
  const rightCenter: Landmark = { x: rightCx, y: rightCy, z: rightCz };
  const d = distance(leftCenter, rightCenter);

  return d < 0.12;
}
