'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { HandRotation } from '../utils/gestureDetection';

interface RotatingCubeProps {
  rotation: HandRotation | null;
  handedness?: string;
}

export default function RotatingCube({ rotation, handedness = 'Right' }: RotatingCubeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cubeRef = useRef<THREE.Mesh | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);
    sceneRef.current = scene;

    // Camera setup
    const camera = new THREE.PerspectiveCamera(
      75,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000
    );
    camera.position.z = 5;
    cameraRef.current = camera;

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Create cube
    const geometry = new THREE.BoxGeometry(2, 2, 2);

    // Create gradient material with edges
    const material = new THREE.MeshPhongMaterial({
      color: handedness === 'Right' ? 0x00ff00 : 0xff0000,
      emissive: handedness === 'Right' ? 0x003300 : 0x330000,
      specular: 0x111111,
      shininess: 30,
      flatShading: false,
    });

    const cube = new THREE.Mesh(geometry, material);
    scene.add(cube);
    cubeRef.current = cube;

    // Add edges to make cube more visible
    const edges = new THREE.EdgesGeometry(geometry);
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      linewidth: 2
    });
    const wireframe = new THREE.LineSegments(edges, lineMaterial);
    cube.add(wireframe);

    // Add lights
    const ambientLight = new THREE.AmbientLight(0x404040, 2);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 5, 5);
    scene.add(directionalLight);

    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight2.position.set(-5, -5, -5);
    scene.add(directionalLight2);

    // Animation loop
    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    // Handle resize
    const handleResize = () => {
      if (!containerRef.current || !camera || !renderer) return;

      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;

      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };

    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (containerRef.current && renderer.domElement) {
        containerRef.current.removeChild(renderer.domElement);
      }
      renderer.dispose();
      geometry.dispose();
      material.dispose();
    };
  }, [handedness]);

  // Update cube rotation based on hand rotation
  useEffect(() => {
    if (!cubeRef.current || !rotation) return;

    // Convert degrees to radians and apply to cube
    // MediaPipe uses different coordinate system, so we adjust
    cubeRef.current.rotation.x = THREE.MathUtils.degToRad(-rotation.pitch);
    cubeRef.current.rotation.y = THREE.MathUtils.degToRad(-rotation.yaw);
    cubeRef.current.rotation.z = THREE.MathUtils.degToRad(rotation.roll);
  }, [rotation]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full rounded-lg overflow-hidden border-2"
      style={{
        borderColor: handedness === 'Right' ? '#00ff00' : '#ff0000'
      }}
    />
  );
}
