import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Flame, Layers, MapPin } from 'lucide-react';

export interface MarkerCounts {
  normal: number;
  homebound: number;
  critical: number;
}

export interface MapLegendProps {
  mapProviderLabel: string;
  showMarkers: boolean;
  markerCounts: MarkerCounts;
  showHeatMap: boolean;
  heatMetricLabel: string;
  heatMetricDescription: string;
  heatPointCount: number;
}

const HEAT_INTENSITY_TIERS = [
  {
    color: '#22c55e',
    label: 'ต่ำ (0.20–0.44)',
    detail: 'พบความเสี่ยงน้อย / กระจายตัวห่าง',
  },
  {
    color: '#eab308',
    label: 'ปานกลาง (0.45–0.69)',
    detail: 'เริ่มมีจุดเฝ้าระวังในพื้นที่',
  },
  {
    color: '#f97316',
    label: 'สูง (0.70–0.89)',
    detail: 'ปัญหาสุขภาพรวมตัวหนาแน่น',
  },
  {
    color: '#dc2626',
    label: 'สูงสุด (0.90–1.00)',
    detail: 'จุดวิกฤต ต้องลงพื้นที่เร่งด่วน',
  },
] as const;

export const MapLegend: React.FC<MapLegendProps> = ({
  mapProviderLabel,
  showMarkers,
  markerCounts,
  showHeatMap,
  heatMetricLabel,
  heatMetricDescription,
  heatPointCount,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <aside
      data-testid="map_legend"
      aria-label="คำอธิบายสัญลักษณ์แผนที่"
      className="absolute bottom-4 left-4 z-[400] bg-white/95 backdrop-blur-xs rounded-2xl shadow-lg border border-slate-200/90 text-xs w-[270px] sm:w-[295px] overflow-hidden"
    >
      {/* Header / Collapse Toggle */}
      <button
        type="button"
        data-testid="map_legend_toggle"
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded((prev) => !prev)}
        className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 bg-slate-50/90 hover:bg-slate-100/90 border-b border-slate-200/70 transition-colors cursor-pointer text-left"
      >
        <span className="font-bold text-slate-800 text-[11px] uppercase tracking-wider flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          <span>สัญลักษณ์แผนที่ ({mapProviderLabel})</span>
        </span>
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
        ) : (
          <ChevronUp className="w-4 h-4 text-slate-500 shrink-0" />
        )}
      </button>

      {isExpanded && (
        <div className="p-3.5 space-y-3 max-h-[340px] overflow-y-auto">
          {/* Household Marker Symbology */}
          <div data-testid="marker_symbology_legend" className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-700 text-[11px] flex items-center gap-1">
                <MapPin className="w-3 h-3 text-emerald-600" />
                <span>หมุดหลังคาเรือน</span>
              </span>
              {!showMarkers && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-medium">
                  ซ่อนอยู่
                </span>
              )}
            </div>

            <div className={`space-y-1.5 ${!showMarkers ? 'opacity-50' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    aria-hidden="true"
                    className="inline-flex items-center justify-center min-w-[26px] h-[18px] px-1.5 rounded-full bg-emerald-500 text-white text-[9px] font-bold border border-white shadow-xs shrink-0"
                  >
                    12
                  </span>
                  <span className="text-slate-700 truncate">ปกติ / ติดสังคม</span>
                </div>
                <span className="text-[11px] font-semibold text-slate-500 tabular-nums shrink-0">
                  {markerCounts.normal}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    aria-hidden="true"
                    className="inline-flex items-center justify-center min-w-[26px] h-[18px] px-1.5 rounded-full bg-amber-500 text-white text-[9px] font-bold border border-white shadow-xs shrink-0"
                  >
                    15
                  </span>
                  <span className="text-slate-700 truncate">ติดบ้าน (ต้องดูแลบางส่วน)</span>
                </div>
                <span className="text-[11px] font-semibold text-amber-700 tabular-nums shrink-0">
                  {markerCounts.homebound}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    aria-hidden="true"
                    className="inline-flex items-center justify-center min-w-[26px] h-[18px] px-1.5 rounded-full bg-rose-500 text-white text-[9px] font-bold border border-white shadow-xs shrink-0"
                  >
                    20
                  </span>
                  <span className="text-slate-700 truncate">ติดเตียง / พบลูกน้ำยุงลาย</span>
                </div>
                <span className="text-[11px] font-semibold text-rose-600 tabular-nums shrink-0">
                  {markerCounts.critical}
                </span>
              </div>

              <div className="flex items-center gap-2 pt-0.5 text-[11px] text-slate-500">
                <span
                  aria-hidden="true"
                  className="inline-flex items-center justify-center min-w-[26px] h-[18px] px-1.5 rounded-full bg-slate-500 text-white text-[9px] font-bold border-2 border-slate-900 shadow-xs shrink-0"
                >
                  •
                </span>
                <span>ขอบเข้ม = หลังคาเรือนที่เลือกดู</span>
              </div>
            </div>
          </div>

          {/* Heat Map Intensity Levels */}
          {showHeatMap && (
            <div
              data-testid="heatmap_intensity_legend"
              className="pt-2.5 border-t border-slate-200/80 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-slate-800 text-[11px] flex items-center gap-1">
                  <Flame className="w-3.5 h-3.5 text-orange-600 shrink-0" />
                  <span className="truncate">ระดับความเข้ม Heat Map</span>
                </span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-800 shrink-0">
                  {heatPointCount} จุด
                </span>
              </div>

              <div className="text-[11px] text-slate-600 bg-orange-50/70 border border-orange-100 rounded-lg px-2 py-1.5">
                <div className="font-semibold text-orange-950">{heatMetricLabel}</div>
                <div className="text-[10px] text-slate-500 leading-snug mt-0.5">
                  {heatMetricDescription}
                </div>
              </div>

              <div className="space-y-1">
                <div
                  aria-label="แถบไล่ระดับสีความหนาแน่นจากน้อยไปมาก"
                  className="h-2.5 w-full rounded-full border border-slate-200/60"
                  style={{
                    background:
                      'linear-gradient(to right, #22c55e 0%, #eab308 35%, #f97316 70%, #dc2626 100%)',
                  }}
                />
                <div className="flex justify-between text-[10px] text-slate-500 font-medium">
                  <span>น้อย (0.2)</span>
                  <span>ปานกลาง (0.6)</span>
                  <span>หนาแน่นสูง (1.0)</span>
                </div>
              </div>

              <div className="space-y-1 pt-0.5">
                {HEAT_INTENSITY_TIERS.map((tier) => (
                  <div key={tier.label} className="flex items-start gap-2 text-[10.5px]">
                    <span
                      aria-hidden="true"
                      className="w-2.5 h-2.5 rounded-xs mt-0.5 shrink-0 border border-black/10"
                      style={{ backgroundColor: tier.color }}
                    />
                    <div className="leading-tight">
                      <span className="font-semibold text-slate-700">{tier.label}:</span>{' '}
                      <span className="text-slate-500">{tier.detail}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </aside>
  );
};
