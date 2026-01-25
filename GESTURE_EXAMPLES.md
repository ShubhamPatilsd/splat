# Gesture Recognition System - Usage Examples

## Overview

Your app now has a comprehensive gesture recognition system that detects:
- **Pinch gestures** (finger combinations)
- **Hand rotation** (for slider controls)
- **Finger states** (extended/closed)
- **Hand poses** (open hand, fist, etc.)

## Core Features

### 1. Pinch Detection

Detects when fingers touch together. Great for:
- Creating points on screen
- Triggering actions
- Selecting objects
- Drawing

**Available Combinations:**
- Thumb + Index (most common)
- Thumb + Middle
- Thumb + Ring
- Thumb + Pinky

**Pinch Properties:**
```typescript
{
  isPinching: boolean;        // Are fingers touching?
  fingers: string[];          // e.g., ['thumb', 'index']
  strength: number;           // 0-1, how close (1 = touching)
  position: { x, y };         // Midpoint between fingers
}
```

### 2. Hand Rotation (Slider Control)

Use hand rotation to control sliders/values:

- **Roll**: Twisting motion (like turning a doorknob)
- **Pitch**: Tilting forward/backward
- **Yaw**: Turning left/right

Values are in degrees (-180 to 180).

**Example Use Cases:**
```typescript
// Volume control with roll
const volume = rotationToSliderValue(gesture.rotation.roll, 0, 100);

// Brightness with pitch
const brightness = rotationToSliderValue(gesture.rotation.pitch, 0, 100);

// Hue/color with yaw
const hue = rotationToSliderValue(gesture.rotation.yaw, 0, 360);
```

### 3. Finger States

Track which fingers are extended:

```typescript
gesture.fingerStates = {
  thumb: true,   // extended
  index: true,
  middle: false, // closed
  ring: false,
  pinky: false
}
```

**Example Gestures:**
- Peace sign: index + middle extended
- Pointing: only index extended
- Rock sign: index + pinky extended
- Number counting: 1-5 fingers

### 4. Pre-built Gestures

```typescript
gesture.isOpen   // All fingers extended (wave hello)
gesture.isFist   // All fingers closed (grab)
```

## Building Custom Gestures

### Example 1: Two-Finger Pinch to Draw

```typescript
const gesture = analyzeGesture(landmarks);

gesture.pinches.forEach(pinch => {
  if (pinch.fingers.includes('thumb') && pinch.fingers.includes('index')) {
    if (pinch.strength > 0.8) {
      // Strong pinch - create point
      const screenPos = normalizeToScreen(
        pinch.position,
        canvasWidth,
        canvasHeight
      );
      createPoint(screenPos.x, screenPos.y);
    }
  }
});
```

### Example 2: Hand Rotation Slider

```typescript
const gesture = analyzeGesture(landmarks);

// Use roll angle for volume
const volume = rotationToSliderValue(gesture.rotation.roll, 0, 100);
setVolume(volume);

// Display slider UI
<div>
  <span>Volume: {volume.toFixed(0)}%</span>
  <div>Rotate hand to adjust</div>
</div>
```

### Example 3: Custom Peace Sign Detector

```typescript
function isPeaceSign(gesture: GestureState): boolean {
  return (
    gesture.fingerStates.index === true &&
    gesture.fingerStates.middle === true &&
    gesture.fingerStates.ring === false &&
    gesture.fingerStates.pinky === false &&
    gesture.fingerStates.thumb === false
  );
}

// Usage
if (isPeaceSign(gesture)) {
  console.log('Peace! ✌️');
}
```

### Example 4: Pinch + Drag System

```typescript
const [isDragging, setIsDragging] = useState(false);
const [dragStartPos, setDragStartPos] = useState<{x: number, y: number} | null>(null);

// In your gesture handler
gesture.pinches.forEach(pinch => {
  if (pinch.isPinching && pinch.strength > 0.7) {
    if (!isDragging) {
      // Start drag
      setIsDragging(true);
      setDragStartPos(pinch.position);
    } else {
      // Update drag position
      const currentPos = normalizeToScreen(
        pinch.position,
        width,
        height
      );
      updateDraggedObject(currentPos);
    }
  } else if (isDragging) {
    // Release
    setIsDragging(false);
    setDragStartPos(null);
  }
});
```

### Example 5: Two-Hand Zoom/Scale

```typescript
// When tracking 2 hands
if (hands.length === 2) {
  const hand1 = hands[0].gesture;
  const hand2 = hands[1].gesture;

  // Calculate distance between palm centers
  const distance = Math.sqrt(
    Math.pow(hand1.palmCenter.x - hand2.palmCenter.x, 2) +
    Math.pow(hand1.palmCenter.y - hand2.palmCenter.y, 2)
  );

  // Map to zoom level (0.5x to 2x)
  const zoom = 0.5 + (distance * 3);
  setZoomLevel(zoom);
}
```

### Example 6: Gesture Combo System

```typescript
interface GestureCombo {
  name: string;
  check: (gesture: GestureState) => boolean;
  action: () => void;
}

const combos: GestureCombo[] = [
  {
    name: 'Select',
    check: (g) => g.pinches.some(p =>
      p.fingers.includes('thumb') &&
      p.fingers.includes('index') &&
      p.strength > 0.8
    ),
    action: () => selectObject()
  },
  {
    name: 'Delete',
    check: (g) => g.isFist,
    action: () => deleteSelected()
  },
  {
    name: 'Reset',
    check: (g) => g.isOpen,
    action: () => resetView()
  }
];

// Execute combos
combos.forEach(combo => {
  if (combo.check(gesture)) {
    combo.action();
  }
});
```

## Real-World Application Ideas

### 1. Drawing App
- Pinch to draw points
- Different finger combos = different colors
- Hand rotation = brush size
- Fist = erase

### 2. Music Visualizer
- Roll = frequency shift
- Pitch = volume
- Yaw = effects intensity
- Pinches = trigger samples

### 3. 3D Object Manipulation
- Pinch + drag = move object
- Two hands distance = scale
- Hand rotation = rotate object
- Open hand = reset

### 4. Presentation Control
- Point right (index only) = next slide
- Point left = previous slide
- Peace sign = show notes
- Fist = black screen

### 5. Gaming
- Different finger patterns = different abilities
- Hand rotation = aim/direction
- Pinch = shoot/interact
- Palm position = movement

## Tips for Best Results

1. **Threshold Tuning**: Adjust `minDetectionConfidence` and `minTrackingConfidence` in HandTracker for your use case
   - Higher = more accurate but slower
   - Lower = faster but more false positives

2. **Pinch Strength**: Use strength thresholds (0.6-0.9) to differentiate between casual touches and intentional pinches

3. **Smoothing**: Add smoothing to rotation values to avoid jitter:
   ```typescript
   const smoothedRoll = lerp(previousRoll, currentRoll, 0.2);
   ```

4. **Debouncing**: Prevent rapid firing of actions:
   ```typescript
   const lastActionTime = useRef(0);
   const now = Date.now();
   if (now - lastActionTime.current > 500) {
     performAction();
     lastActionTime.current = now;
   }
   ```

5. **Visual Feedback**: Always show users what gesture is detected - helps with accuracy and UX

## Accessing Gesture Data

The gesture system provides 21 landmarks per hand with x, y, z coordinates. See `gestureDetection.ts` for the full landmark enum and utility functions.

Key utilities:
- `analyzeGesture(landmarks)` - Get complete gesture state
- `detectAllPinches(landmarks)` - Get all active pinches
- `calculateHandRotation(landmarks)` - Get roll/pitch/yaw
- `normalizeToScreen(pos, w, h)` - Convert to pixel coords
- `rotationToSliderValue(angle, min, max)` - Map rotation to range
