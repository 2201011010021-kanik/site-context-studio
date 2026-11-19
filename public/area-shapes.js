// Rectangle corners are kept in NW, NE, SE, SW order, in Leaflet [lat, lng] coordinates.
export function squareAt(center, sideMeters = 400) {
  const [lat, lng] = center;
  const halfLat = sideMeters / (2 * 110574);
  const halfLng = sideMeters / (2 * 111320 * Math.max(0.01, Math.cos(lat * Math.PI / 180)));
  return [[lat + halfLat, lng - halfLng], [lat + halfLat, lng + halfLng],
    [lat - halfLat, lng + halfLng], [lat - halfLat, lng - halfLng]];
}

export function resizeRectangle(points, corner, position, minMeters = 12) {
  if (points.length !== 4 || corner < 0 || corner > 3) throw new Error('Select a rectangle corner.');
  const opposite = points[(corner + 2) % 4];
  const latGap = minMeters / 110574;
  const lngGap = minMeters / (111320 * Math.max(0.01, Math.cos(opposite[0] * Math.PI / 180)));
  const north = corner < 2;
  const west = corner === 0 || corner === 3;
  const movingLat = north ? Math.max(position[0], opposite[0] + latGap) : Math.min(position[0], opposite[0] - latGap);
  const movingLng = west ? Math.min(position[1], opposite[1] - lngGap) : Math.max(position[1], opposite[1] + lngGap);
  const top = north ? movingLat : opposite[0], bottom = north ? opposite[0] : movingLat;
  const left = west ? movingLng : opposite[1], right = west ? opposite[1] : movingLng;
  return [[top, left], [top, right], [bottom, right], [bottom, left]];
}

export function rectangleDimensions(points) {
  if (points.length !== 4) return null;
  const latitude = (points[0][0] + points[2][0]) / 2;
  return {
    width: Math.abs(points[1][1] - points[0][1]) * 111320 * Math.cos(latitude * Math.PI / 180),
    height: Math.abs(points[0][0] - points[3][0]) * 110574
  };
}
