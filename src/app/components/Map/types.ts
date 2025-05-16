export interface MapComponentProps {
  center: [number, number];
  zoom: number;
  onViewportChange?: (center: [number, number], zoom: number) => void;
  onFaceClick?: (faceId: string) => void;
  onFaceHover?: (faceId: string | null) => void;
}

