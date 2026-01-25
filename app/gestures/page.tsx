import GestureTracker from './GestureTracker';
import Link from 'next/link';

export default function GesturesPage() {
  return (
    <div className="w-screen h-screen overflow-hidden relative">
      <GestureTracker />
      <Link
        href="/"
        className="absolute top-4 left-4 z-50 bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-lg"
      >
        ← Back to Physics Demo
      </Link>
    </div>
  );
}
