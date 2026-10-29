import { useEffect, useId, useRef, useState } from 'react';
import { formatTime } from '../progress';
import type { ProgressMetric } from '../progress';

interface Point { id: string; date: string; label: string; value: number }
export default function ProgressChart({ points, metric, onOpenSession }: {
  points: Point[]; metric: ProgressMetric; onOpenSession: (id: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const gradientId = useId().replace(/:/g, '');
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined' || !ref.current) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(280, entries[0].contentRect.width)));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  if (!points.length) return <div className="progress-chart-empty">No results for this chart yet.</div>;
  const height = 250, left = 54, right = 18, top = 24, bottom = 44;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const values = points.map(point => point.value);
  const maximum = metric === 'score' ? 100 : Math.max(1, Math.ceil(Math.max(...values) * 1.12));
  const minimum = metric === 'row_2k' ? Math.max(0, Math.floor(Math.min(...values) * 0.92)) : 0;
  const y = (value: number) => top + (maximum - value) / (maximum - minimum) * plotHeight;
  const dates = points.map(point => Date.parse(point.date));
  const span = Math.max(...dates) - Math.min(...dates);
  const x = (index: number) => metric === 'sessions'
    ? left + plotWidth * (index + 0.5) / points.length
    : span ? left + (dates[index] - Math.min(...dates)) / span * plotWidth : left + plotWidth / 2;
  const display = (value: number) => metric === 'plank' || metric === 'row_2k' ? formatTime(value) : String(Math.round(value));
  const line = points.map((point, index) => x(index) + ',' + y(point.value)).join(' ');
  const labels = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  return <div ref={ref} className="progress-chart">
    <svg viewBox={'0 0 ' + width + ' ' + height} width="100%" height={height} role="img"
      aria-label={metric === 'sessions' ? 'Completed sessions by period' : metric + ' across ' + points.length + ' recorded sessions'}>
      <defs><linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stopColor="#9ef542" stopOpacity="0.32" />
        <stop offset="100%" stopColor="#9ef542" stopOpacity="0.01" />
      </linearGradient></defs>
      {[0, 1, 2, 3, 4].map(index => {
        const value = minimum + (maximum - minimum) * index / 4;
        return <g key={index}>
          <line x1={left} y1={y(value)} x2={width - right} y2={y(value)} className="progress-gridline" />
          <text x={left - 10} y={y(value) + 4} textAnchor="end" className="progress-axis">{display(value)}</text>
        </g>;
      })}
      {metric === 'sessions' ? points.map((point, index) => {
        const barWidth = Math.min(58, plotWidth / points.length * 0.62);
        return <g key={point.id}>
          <rect x={x(index) - barWidth / 2} y={y(point.value)} width={barWidth}
            height={height - bottom - y(point.value)} rx="5"
            fill={index === points.length - 1 ? '#9ef542' : '#637a9c'}>
            <title>{point.label + ': ' + point.value + ' sessions'}</title>
          </rect>
          <text x={x(index)} y={y(point.value) - 8} textAnchor="middle" className="progress-axis">{point.value}</text>
        </g>;
      }) : <>
        {points.length > 1 && <polygon points={x(0) + ',' + (height - bottom) + ' ' + line + ' ' + x(points.length - 1) + ',' + (height - bottom)}
          fill={'url(#' + gradientId + ')'} />}
        <polyline points={line} fill="none" className="progress-line" strokeWidth="3" strokeLinejoin="round" />
        {points.map((point, index) => <circle key={point.id} cx={x(index)} cy={y(point.value)} r="5"
          className="progress-point" role="button" tabIndex={0}
          aria-label={'Open ' + point.label + ': ' + display(point.value)}
          onClick={() => onOpenSession(point.id)}
          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpenSession(point.id); } }}>
          <title>{point.label + ': ' + display(point.value)}</title>
        </circle>)}
      </>}
      {labels.map(index => <text key={index} x={x(index)} y={height - 14}
        textAnchor={metric !== 'sessions' && points.length > 1 ? index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle' : 'middle'}
        className="progress-axis">{points[index].label.replace(' ' + new Date(points[index].date).getFullYear(), '')}</text>)}
    </svg>
  </div>;
}
