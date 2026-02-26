import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { setSharedCamera } from './ui/BoxSelection';

/** Syncs the R3F camera to the shared module ref so HTML overlays can use it */
export function CameraProvider() {
  const { camera } = useThree();
  useEffect(() => {
    setSharedCamera(camera);
  }, [camera]);
  return null;
}
