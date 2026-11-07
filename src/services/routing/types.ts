export interface LatLng {
  lat: number;
  lng: number;
}

export interface TravelMatrix {
  /** durations[i][j] = segundos de carro de i até j (assimétrica: respeita mão única). */
  durations: number[][];
  distances?: number[][];
  method: 'malha-viaria' | 'linha-reta';
  provider: string;
}

/** Contrato para trocar o motor de roteirização (OSRM público hoje; OSRM próprio, GraphHopper, Google etc. no futuro). */
export interface MatrixProvider {
  name: string;
  matrix(points: LatLng[], signal?: AbortSignal): Promise<TravelMatrix>;
}
