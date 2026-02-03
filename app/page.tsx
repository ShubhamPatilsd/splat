import HandTracker from './components/HandTracker';
import Image from 'next/image';

export default function Home() {
  return (
    <div className="w-screen h-screen overflow-hidden relative">
      <HandTracker />
      <div className="absolute bottom-4 right-4 z-20 max-w-[220px] rounded-xl bg-black/70 p-3 text-xs text-white shadow-lg backdrop-blur">
        <div className="mb-2 font-semibold">Switch modes</div>
        <Image
          src="/tutorial.png"
          alt="Knuckles together gesture to switch between physics and drawing modes"
          className="h-auto w-full rounded-md"
          width={220}
          height={165}
        />
        <div className="mt-2 text-[11px] text-white/80">
          Press knuckles together to toggle physics ↔ drawing
        </div>
      </div>
    </div>
  );
}
