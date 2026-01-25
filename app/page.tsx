import HandTracker from './components/HandTracker';
import Link from 'next/link';

export default function Home() {
  return (
    <div className="w-screen h-screen overflow-hidden relative">
      <HandTracker />
      <Link
        href="/gestures"
        className="absolute top-36 right-4 z-50 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-lg"
      >
        Gesture Tracker →
      </Link>
    </div>
  );
}
