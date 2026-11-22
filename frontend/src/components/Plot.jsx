import React, { useEffect, useMemo, useRef } from 'react';
import Plotly from 'plotly.js-dist-min';

// Paleta y tema compartido para mantener coherencia visual (tonos verdes del sistema).
export const CHART_COLORS = ['#087968', '#2f9e8f', '#67c3b4', '#f0a63a', '#d9534f', '#3b7dd8'];

export const baseLayout = (overrides = {}) => ({
  margin: { l: 52, r: 20, t: 24, b: 44 },
  paper_bgcolor: '#ffffff',
  plot_bgcolor: '#ffffff',
  font: { family: 'Inter, system-ui, sans-serif', size: 12, color: '#18312b' },
  xaxis: { gridcolor: '#e4eee9', zerolinecolor: '#cfe0da' },
  yaxis: { gridcolor: '#e4eee9', zerolinecolor: '#cfe0da' },
  hovermode: 'x unified',
  legend: { orientation: 'h', y: -0.18 },
  ...overrides,
});

// Envoltorio delgado de Plotly para React. Los datos se serializan para decidir
// cuándo re-renderizar y se purga la instancia al desmontar.
export default function Plot({ data, layout, config, style, className }) {
  const ref = useRef(null);
  const dataKey = useMemo(() => JSON.stringify(data), [data]);
  const layoutKey = useMemo(() => JSON.stringify(layout), [layout]);

  useEffect(() => {
    if (!ref.current) return;
    const conf = { responsive: true, displaylogo: false, modeBarButtonsToRemove: ['lasso2d', 'select2d'], ...config };
    Plotly.react(ref.current, data, layout, conf);
  }, [dataKey, layoutKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      if (ref.current) Plotly.purge(ref.current);
    },
    []
  );

  return <div ref={ref} className={className} style={{ width: '100%', ...style }} />;
}

// Descarga la figura como PNG de alta resolución (600 DPI equivalentes).
export async function downloadFigure(node, filename, scale = 3) {
  if (!node) return;
  await Plotly.downloadImage(node, { format: 'png', scale, filename });
}
