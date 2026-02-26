import { Grid } from '@react-three/drei';
import { useSettingsStore } from '../store/settingsStore';

export function GridFloor() {
  const gridVisible = useSettingsStore(s => s.gridVisible);
  const gridSnapSize = useSettingsStore(s => s.gridSnapSize);
  const theme = useSettingsStore(s => s.theme);

  if (!gridVisible) return null;

  const isLight = theme === 'light';

  return (
    <Grid
      position={[0, -0.26, 0]}
      args={[40, 40]}
      cellSize={gridSnapSize}
      cellThickness={0.5}
      cellColor={isLight ? '#b0b0c0' : '#1a1a2e'}
      sectionSize={gridSnapSize * 5}
      sectionThickness={1}
      sectionColor={isLight ? '#9090a8' : '#2a2a3e'}
      fadeDistance={25}
      fadeStrength={1}
      infiniteGrid
    />
  );
}
