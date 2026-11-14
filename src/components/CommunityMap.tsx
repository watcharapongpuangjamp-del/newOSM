import React, { useState, useEffect, useRef, useMemo } from 'react';
import L from 'leaflet';
import { HeatLayer, type HeatLatLng } from 'leaflet.heat';
import { APIProvider, Map as GoogleMap, AdvancedMarker, Pin, InfoWindow, useMap } from '@vis.gl/react-google-maps';
import {
  MapPin,
  Plus,
  Navigation,
  Crosshair,
  Users,
  Bug,
  Eye,
  Flame,
  Layers,
} from 'lucide-react';
import { Household, Person, Village, VhvMember } from '../types';

interface CommunityMapProps {
  households: Household[];
  persons: Person[];
  villages: Village[];
  vhvMembers: VhvMember[];
  selectedVillageNo: number;
  focusedHousehold?: Household | null;
  onViewHouseholdDetail: (household: Household) => void;
  onAddHouseholdAtCoords: (lat: number, lng: number) => void;
}

type HeatMetricMode = 'all_issues' | 'larva' | 'vulnerable' | 'sanitation' | 'ncds';

const HEAT_METRIC_CONFIG: Record<
  HeatMetricMode,
  { label: string; shortLabel: string; description: string }
> = {
  all_issues: {
    label: 'ความหนาแน่นปัญหาสุขภาพรวม',
    shortLabel: 'ปัญหาสุขภาพรวม',
    description: 'รวมจุดพบลูกน้ำยุงลาย, สุขาภิบาลต้องปรับปรุง, ผู้ป่วยติดบ้าน/ติดเตียง และโรคเรื้อรัง NCDs',
  },
  larva: {
    label: 'แหล่งพบลูกน้ำยุงลาย (HI)',
    shortLabel: 'ลูกน้ำยุงลาย',
    description: 'แสดงความหนาแน่นของหลังคาเรือนที่ตรวจพบลูกน้ำยุงลายเพื่อวางแผนพ่นหมอกควันและใส่ทรายอะเบท',
  },
  vulnerable: {
    label: 'กลุ่มเปราะบาง (ติดบ้าน/ติดเตียง)',
    shortLabel: 'ติดบ้าน/ติดเตียง',
    description: 'แสดงความหนาแน่นของผู้ป่วยติดเตียงและติดบ้านที่ต้องเยี่ยมดูแลต่อเนื่อง',
  },
  sanitation: {
    label: 'สุขาภิบาลต้องปรับปรุง/พอใช้',
    shortLabel: 'สุขาภิบาล',
    description: 'แสดงจุดเสี่ยงด้านสิ่งแวดล้อม น้ำขัง และการจัดการขยะในครัวเรือน',
  },
  ncds: {
    label: 'กลุ่มผู้ป่วยโรคเรื้อรัง (NCDs)',
    shortLabel: 'โรคเรื้อรัง NCDs',
    description: 'แสดงการกระจายตัวของครัวเรือนที่มีผู้ป่วยเบาหวาน ความดัน หรือโรคเรื้อรัง',
  },
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function computeHouseholdHeatWeight(
  house: Household,
  houseMembers: Person[],
  metric: HeatMetricMode
): number {
  const bedriddenCount = houseMembers.filter((p) => p.careCategory === 'bedridden').length;
  const homeboundCount = houseMembers.filter((p) => p.careCategory === 'homebound').length;
  const ncdCount = houseMembers.filter((p) => p.chronicDiseases.length > 0).length;

  switch (metric) {
    case 'larva':
      return house.mosquitoLarvaFound ? 1.0 : 0;
    case 'vulnerable': {
      const score = bedriddenCount * 0.65 + homeboundCount * 0.35;
      return Math.min(1.0, score);
    }
    case 'sanitation':
      if (house.sanitationRating === 'poor') return 1.0;
      if (house.sanitationRating === 'fair') return 0.55;
      return 0;
    case 'ncds':
      return Math.min(1.0, ncdCount * 0.45);
    case 'all_issues':
    default: {
      let score = 0;
      if (house.mosquitoLarvaFound) score += 0.55;
      if (house.sanitationRating === 'poor') score += 0.35;
      else if (house.sanitationRating === 'fair') score += 0.15;
      score += bedriddenCount * 0.45;
      score += homeboundCount * 0.25;
      if (ncdCount > 0) score += Math.min(0.3, ncdCount * 0.15);
      return Math.min(1.0, score);
    }
  }
}

const GoogleMapPanController: React.FC<{ center: { lat: number; lng: number }; zoom?: number }> = ({
  center,
  zoom,
}) => {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    map.panTo(center);
    if (zoom) {
      map.setZoom(zoom);
    }
  }, [map, center.lat, center.lng, zoom]);
  return null;
};

type HeatLayerInstance = L.Layer & {
  setLatLngs: (latlngs: HeatLatLng[]) => void;
  redraw: () => void;
};

export const CommunityMap: React.FC<CommunityMapProps> = ({
  households,
  persons,
  villages,
  vhvMembers,
  selectedVillageNo,
  focusedHousehold,
  onViewHouseholdDetail,
  onAddHouseholdAtCoords,
}) => {
  const [filterMode, setFilterMode] = useState<'all' | 'bedridden' | 'larva'>('all');
  const [showHeatMap, setShowHeatMap] = useState<boolean>(true);
  const [showMarkers, setShowMarkers] = useState<boolean>(true);
  const [heatMetric, setHeatMetric] = useState<HeatMetricMode>('all_issues');
  const [selectedHouse, setSelectedHouse] = useState<Household | null>(focusedHousehold || null);
  const [clickedCoords, setClickedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [geoMessage, setGeoMessage] = useState<string | null>(null);

  const leafletContainerRef = useRef<HTMLDivElement | null>(null);
  const leafletMapRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const heatLayerRef = useRef<HeatLayerInstance | null>(null);

  const currentVillage = villages.find((v) => v.no === selectedVillageNo) ||
    villages[0] || {
      centerLat: 18.7883,
      centerLng: 98.9853,
    };

  const center = focusedHousehold
    ? { lat: focusedHousehold.latitude, lng: focusedHousehold.longitude }
    : { lat: currentVillage.centerLat, lng: currentVillage.centerLng };

  const scopedHouses = useMemo(
    () =>
      households.filter(
        (h) => selectedVillageNo === 0 || h.villageNo === selectedVillageNo
      ),
    [households, selectedVillageNo]
  );

  const displayHouses = useMemo(
    () =>
      scopedHouses.filter((h) => {
        if (filterMode === 'larva' && !h.mosquitoLarvaFound) return false;
        if (filterMode === 'bedridden') {
          const hasBedridden = persons.some(
            (p) => p.householdId === h.id && p.careCategory === 'bedridden'
          );
          if (!hasBedridden) return false;
        }
        return true;
      }),
    [scopedHouses, persons, filterMode]
  );

  const membersByHouseId = useMemo(() => {
    const map = new Map<string, Person[]>();
    for (const p of persons) {
      const existing = map.get(p.householdId);
      if (existing) {
        existing.push(p);
      } else {
        map.set(p.householdId, [p]);
      }
    }
    return map;
  }, [persons]);

  const heatPoints = useMemo<HeatLatLng[]>(() => {
    const points: HeatLatLng[] = [];
    for (const house of scopedHouses) {
      if (!Number.isFinite(house.latitude) || !Number.isFinite(house.longitude)) continue;
      const members = membersByHouseId.get(house.id) || [];
      const weight = computeHouseholdHeatWeight(house, members, heatMetric);
      if (weight > 0) {
        points.push([house.latitude, house.longitude, weight]);
      }
    }
    return points;
  }, [scopedHouses, membersByHouseId, heatMetric]);

  const villageHeatSummaries = useMemo(() => {
    return villages.map((v) => {
      const vHouses = households.filter((h) => h.villageNo === v.no);
      let issueHouseCount = 0;
      let larvaCount = 0;
      let vulnerableCount = 0;

      for (const h of vHouses) {
        const members = membersByHouseId.get(h.id) || [];
        if (h.mosquitoLarvaFound) larvaCount++;
        vulnerableCount += members.filter(
          (p) => p.careCategory === 'bedridden' || p.careCategory === 'homebound'
        ).length;
        if (computeHouseholdHeatWeight(h, members, heatMetric) > 0) {
          issueHouseCount++;
        }
      }

      return {
        village: v,
        totalHouses: vHouses.length,
        issueHouseCount,
        larvaCount,
        vulnerableCount,
      };
    });
  }, [villages, households, membersByHouseId, heatMetric]);

  const apiKey = (
    (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_GOOGLE_MAPS_API_KEY || ''
  ).trim();
  const useGoogleMaps = apiKey.length > 0;

  useEffect(() => {
    if (focusedHousehold) {
      setSelectedHouse(focusedHousehold);
    }
  }, [focusedHousehold]);

  // Initialize Leaflet map when not using Google Maps
  useEffect(() => {
    if (useGoogleMaps || !leafletContainerRef.current) return;

    const map = L.map(leafletContainerRef.current, {
      center: [center.lat, center.lng],
      zoom: focusedHousehold ? 18 : 15,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    const markersLayer = L.layerGroup().addTo(map);
    leafletMapRef.current = map;
    markersLayerRef.current = markersLayer;

    map.on('click', (e: L.LeafletMouseEvent) => {
      setClickedCoords({
        lat: Number(e.latlng.lat.toFixed(6)),
        lng: Number(e.latlng.lng.toFixed(6)),
      });
    });

    // Ensure proper dimensions after tab switch animation
    const resizeTimer = window.setTimeout(() => {
      map.invalidateSize();
      heatLayerRef.current?.redraw();
    }, 180);

    return () => {
      window.clearTimeout(resizeTimer);
      if (heatLayerRef.current) {
        map.removeLayer(heatLayerRef.current);
        heatLayerRef.current = null;
      }
      map.remove();
      leafletMapRef.current = null;
      markersLayerRef.current = null;
    };
  }, [useGoogleMaps]);

  // Pan or fit Leaflet map when village, focused household, or multi-village view changes
  useEffect(() => {
    if (useGoogleMaps || !leafletMapRef.current) return;
    const map = leafletMapRef.current;

    if (focusedHousehold) {
      map.setView([focusedHousehold.latitude, focusedHousehold.longitude], 18, { animate: true });
      return;
    }

    if (selectedVillageNo === 0 && scopedHouses.length > 1) {
      const coords = scopedHouses
        .filter((h) => Number.isFinite(h.latitude) && Number.isFinite(h.longitude))
        .map((h) => [h.latitude, h.longitude] as [number, number]);
      if (coords.length > 1) {
        map.fitBounds(L.latLngBounds(coords), { padding: [48, 48], maxZoom: 16, animate: true });
        return;
      }
    }

    map.setView([center.lat, center.lng], 16, { animate: true });
  }, [useGoogleMaps, center.lat, center.lng, focusedHousehold, selectedVillageNo, scopedHouses]);

  // Manage leaflet.heat HeatLayer
  useEffect(() => {
    if (useGoogleMaps || !leafletMapRef.current) return;
    const map = leafletMapRef.current;

    if (!showHeatMap) {
      if (heatLayerRef.current) {
        map.removeLayer(heatLayerRef.current);
        heatLayerRef.current = null;
      }
      return;
    }

    if (!heatLayerRef.current) {
      const heatLayer = new HeatLayer(heatPoints, {
        radius: 36,
        blur: 24,
        maxZoom: 18,
        minOpacity: 0.35,
        max: 1.0,
        gradient: {
          0.2: '#22c55e',
          0.45: '#eab308',
          0.7: '#f97316',
          1.0: '#dc2626',
        },
      }) as unknown as HeatLayerInstance;
      heatLayer.addTo(map);
      heatLayerRef.current = heatLayer;
    } else {
      heatLayerRef.current.setLatLngs(heatPoints);
    }
  }, [useGoogleMaps, showHeatMap, heatPoints]);

  // Render Leaflet markers
  useEffect(() => {
    if (useGoogleMaps || !markersLayerRef.current) return;
    const layer = markersLayerRef.current;
    layer.clearLayers();

    if (!showMarkers) return;

    displayHouses.forEach((house) => {
      const houseMembers = membersByHouseId.get(house.id) || [];
      const hasBedridden = houseMembers.some((p) => p.careCategory === 'bedridden');
      const hasHomebound = houseMembers.some((p) => p.careCategory === 'homebound');

      let pinBackground = '#10b981'; // Emerald (normal)
      if (hasBedridden || house.mosquitoLarvaFound) {
        pinBackground = '#ef4444'; // Rose (critical)
      } else if (hasHomebound) {
        pinBackground = '#f59e0b'; // Amber (watch)
      }

      const isFocused = selectedHouse?.id === house.id;
      const safeNo = escapeHtml(house.houseNo.slice(0, 5));

      const icon = L.divIcon({
        className: 'smart-osm-marker',
        html: `<div style="
          display:inline-flex;
          align-items:center;
          justify-content:center;
          min-width:34px;
          height:28px;
          padding:0 7px;
          border-radius:9999px;
          background:${pinBackground};
          color:#ffffff;
          font-family:Sarabun,sans-serif;
          font-size:11px;
          font-weight:700;
          border:${isFocused ? '3px solid #0f172a' : '2px solid #ffffff'};
          box-shadow:0 3px 10px rgba(15,23,42,0.28);
          white-space:nowrap;
        ">${safeNo}</div>`,
        iconSize: [38, 28],
        iconAnchor: [19, 14],
      });

      const marker = L.marker([house.latitude, house.longitude], { icon });
      marker.on('click', () => {
        setSelectedHouse(house);
      });
      marker.addTo(layer);
    });
  }, [useGoogleMaps, showMarkers, displayHouses, membersByHouseId, selectedHouse?.id]);

  const handleLocateMe = () => {
    if (!navigator.geolocation) {
      setGeoMessage('อุปกรณ์นี้ไม่รองรับการดึงพิกัด GPS');
      return;
    }
    setIsLocating(true);
    setGeoMessage(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        setIsLocating(false);
        setClickedCoords({ lat, lng });
        if (!useGoogleMaps && leafletMapRef.current) {
          leafletMapRef.current.setView([lat, lng], 18, { animate: true });
        }
      },
      (err) => {
        setIsLocating(false);
        setGeoMessage(`ไม่สามารถดึงตำแหน่ง GPS ได้: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleFocusVillage = (village: Village) => {
    if (!useGoogleMaps && leafletMapRef.current) {
      leafletMapRef.current.setView([village.centerLat, village.centerLng], 17, {
        animate: true,
      });
    }
  };

  const selectedHouseMembers = selectedHouse
    ? membersByHouseId.get(selectedHouse.id) || []
    : [];
  const selectedHouseVhv = selectedHouse
    ? vhvMembers.find((v) => v.id === selectedHouse.vhvMemberId)
    : undefined;

  return (
    <div className="space-y-4 pb-12">
      {/* Map Control Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-800 flex items-center gap-2">
              <MapPin className="w-6 h-6 text-emerald-600" />
              <span>
                แผนที่สุขภาพชุมชน ({useGoogleMaps ? 'Google Maps GIS' : 'OpenStreetMap GIS'})
              </span>
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              คลิกบนหมุดบ้านเพื่อดูข้อมูลสมาชิก, เปิดแผนที่ความหนาแน่น (Heat Map) หรือแตะบนแผนที่เพื่อเพิ่มหลังคาเรือนใหม่
            </p>
          </div>

          {/* Filter & GPS buttons */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => setFilterMode('all')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                filterMode === 'all'
                  ? 'bg-emerald-700 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              แสดงทั้งหมด ({displayHouses.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('bedridden')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                filterMode === 'bedridden'
                  ? 'bg-rose-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              ผู้ป่วยติดเตียง 🔴
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('larva')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                filterMode === 'larva'
                  ? 'bg-amber-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              พบลูกน้ำยุงลาย ⚠️
            </button>
            <button
              type="button"
              data-testid="locate_me_button"
              onClick={handleLocateMe}
              disabled={isLocating}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Crosshair className={`w-3.5 h-3.5 ${isLocating ? 'animate-spin' : ''}`} />
              <span>{isLocating ? 'กำลังค้นหา GPS...' : 'ตำแหน่งฉัน'}</span>
            </button>
          </div>
        </div>

        {/* Heat Map Layer Controls (Leaflet / OpenStreetMap) */}
        {!useGoogleMaps && (
          <div className="pt-3 border-t border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="heatmap_toggle_button"
                onClick={() => setShowHeatMap((prev) => !prev)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer border ${
                  showHeatMap
                    ? 'bg-orange-600 text-white border-orange-600 shadow-xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Flame className="w-3.5 h-3.5" />
                <span>Heat Map ความหนาแน่น: {showHeatMap ? 'เปิด' : 'ปิด'}</span>
              </button>

              <button
                type="button"
                data-testid="markers_toggle_button"
                onClick={() => setShowMarkers((prev) => !prev)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer border ${
                  showMarkers
                    ? 'bg-slate-800 text-white border-slate-800'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>หมุดบ้าน: {showMarkers ? 'แสดง' : 'ซ่อน'}</span>
              </button>

              {showHeatMap && (
                <select
                  aria-label="เลือกตัวชี้วัด Heat Map"
                  data-testid="heatmap_metric_select"
                  value={heatMetric}
                  onChange={(e) => setHeatMetric(e.target.value as HeatMetricMode)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-orange-50 text-orange-950 border border-orange-200 focus:outline-none focus:border-orange-400"
                >
                  {(Object.keys(HEAT_METRIC_CONFIG) as HeatMetricMode[]).map((key) => (
                    <option key={key} value={key}>
                      {HEAT_METRIC_CONFIG[key].label}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {showHeatMap && (
              <div className="text-[11px] text-slate-600 flex items-center gap-2">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 font-semibold border border-orange-200">
                  พบจุดเสี่ยง {heatPoints.length} หลังคาเรือน
                </span>
                <span className="hidden xl:inline text-slate-500">
                  {HEAT_METRIC_CONFIG[heatMetric].description}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Cross-Village Density Breakdown Chips */}
      {!useGoogleMaps && showHeatMap && villageHeatSummaries.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {villageHeatSummaries.map(({ village, totalHouses, issueHouseCount, larvaCount, vulnerableCount }) => {
            const issuePercent = totalHouses > 0 ? Math.round((issueHouseCount / totalHouses) * 100) : 0;
            const isSelected = selectedVillageNo === village.no;
            return (
              <button
                key={village.id}
                type="button"
                onClick={() => handleFocusVillage(village)}
                className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-orange-50/90 border-orange-300 shadow-xs'
                    : 'bg-white border-slate-200 hover:border-orange-200 hover:bg-orange-50/30'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-800">
                    หมู่ {village.no} {village.name}
                  </span>
                  <span
                    className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                      issuePercent >= 40
                        ? 'bg-rose-100 text-rose-700'
                        : issuePercent > 0
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-emerald-100 text-emerald-700'
                    }`}
                  >
                    จุดเสี่ยง {issueHouseCount}/{totalHouses} หลัง ({issuePercent}%)
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-500">
                  <span className="inline-flex items-center gap-1">
                    <Bug className="w-3 h-3 text-rose-500" />
                    ลูกน้ำ: <strong className="text-slate-700">{larvaCount}</strong> หลัง
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Users className="w-3 h-3 text-amber-600" />
                    ติดบ้าน/เตียง: <strong className="text-slate-700">{vulnerableCount}</strong> คน
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {geoMessage && (
        <div className="px-4 py-2.5 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-xs">
          {geoMessage}
        </div>
      )}

      {/* Map Viewport Area */}
      <div className="relative w-full h-[540px] sm:h-[580px] bg-slate-100 rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {useGoogleMaps ? (
          <APIProvider apiKey={apiKey}>
            <GoogleMap
              defaultCenter={center}
              defaultZoom={focusedHousehold ? 18 : 16}
              mapId="DEMO_MAP_ID"
              internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
              style={{ width: '100%', height: '100%' }}
              onClick={(e) => {
                if (e.detail.latLng) {
                  setClickedCoords({
                    lat: Number(e.detail.latLng.lat.toFixed(6)),
                    lng: Number(e.detail.latLng.lng.toFixed(6)),
                  });
                }
              }}
            >
              <GoogleMapPanController center={center} zoom={focusedHousehold ? 18 : 16} />
              {displayHouses.map((house) => {
                const houseMembers = membersByHouseId.get(house.id) || [];
                const hasBedridden = houseMembers.some((p) => p.careCategory === 'bedridden');
                const hasHomebound = houseMembers.some((p) => p.careCategory === 'homebound');

                let pinBackground = '#10b981';
                if (hasBedridden || house.mosquitoLarvaFound) {
                  pinBackground = '#ef4444';
                } else if (hasHomebound) {
                  pinBackground = '#f59e0b';
                }

                return (
                  <AdvancedMarker
                    key={house.id}
                    position={{ lat: house.latitude, lng: house.longitude }}
                    onClick={() => setSelectedHouse(house)}
                  >
                    <Pin background={pinBackground} glyphColor="#ffffff" borderColor="#ffffff">
                      <span style={{ fontSize: '10px', fontWeight: 'bold' }}>
                        {house.houseNo.slice(0, 3)}
                      </span>
                    </Pin>
                  </AdvancedMarker>
                );
              })}

              {selectedHouse && (
                <InfoWindow
                  position={{ lat: selectedHouse.latitude, lng: selectedHouse.longitude }}
                  onCloseClick={() => setSelectedHouse(null)}
                >
                  <div style={{ fontFamily: 'Sarabun, sans-serif', width: '210px', padding: '4px' }}>
                    <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#0f172a', marginBottom: '4px' }}>
                      บ้านเลขที่ {selectedHouse.houseNo}
                    </div>
                    <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '6px' }}>
                      หมู่ {selectedHouse.villageNo} {selectedHouse.villageName}
                    </div>
                    <div style={{ fontSize: '12px', marginBottom: '4px' }}>
                      <strong>เจ้าบ้าน:</strong> {selectedHouse.headOfHouseholdName}
                    </div>
                    <div style={{ fontSize: '12px', marginBottom: '6px' }}>
                      <strong>สมาชิก:</strong> {selectedHouseMembers.length} คน
                    </div>
                    {selectedHouse.mosquitoLarvaFound && (
                      <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#e11d48', marginBottom: '6px' }}>
                        ⚠️ พบลูกน้ำยุงลาย
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => onViewHouseholdDetail(selectedHouse)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        background: '#059669',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                      }}
                    >
                      ดูข้อมูลสมาชิก & รายละเอียด
                    </button>
                  </div>
                </InfoWindow>
              )}
            </GoogleMap>
          </APIProvider>
        ) : (
          <div ref={leafletContainerRef} className="w-full h-full z-0" />
        )}

        {/* Selected House Detail Overlay Card (used in OpenStreetMap mode) */}
        {!useGoogleMaps && selectedHouse && (
          <div className="absolute top-4 left-4 right-4 sm:right-auto sm:w-72 z-[400] bg-white/95 backdrop-blur-xs p-4 rounded-2xl shadow-xl border border-emerald-200 space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  บ้านเลขที่ {selectedHouse.houseNo}
                </h3>
                <p className="text-[11px] text-slate-500">
                  หมู่ {selectedHouse.villageNo} {selectedHouse.villageName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedHouse(null)}
                aria-label="ปิดรายละเอียดบ้าน"
                className="text-slate-400 hover:text-slate-700 text-sm px-1.5 py-0.5 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="text-xs space-y-1 text-slate-700 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
              <div>
                <strong>เจ้าบ้าน:</strong> {selectedHouse.headOfHouseholdName}
              </div>
              <div className="flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-emerald-600" />
                <span>
                  <strong>สมาชิก:</strong> {selectedHouseMembers.length} คน
                </span>
              </div>
              {selectedHouseVhv && (
                <div>
                  <strong>อสม. ดูแล:</strong> {selectedHouseVhv.name}
                </div>
              )}
              {selectedHouse.mosquitoLarvaFound && (
                <div className="flex items-center gap-1 text-rose-600 font-bold pt-0.5">
                  <Bug className="w-3.5 h-3.5" />
                  <span>พบลูกน้ำยุงลาย</span>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => onViewHouseholdDetail(selectedHouse)}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>ดูข้อมูลสมาชิก & รายละเอียด</span>
            </button>
          </div>
        )}

        {/* Map Legend Overlay */}
        <div className="absolute bottom-4 left-4 z-[400] bg-white/95 backdrop-blur-xs p-3 rounded-xl shadow-md border border-slate-200 text-xs space-y-2 max-w-[250px]">
          <div className="space-y-1.5">
            <span className="font-bold text-slate-800 block text-[11px] uppercase tracking-wider">
              สัญลักษณ์พิกัด ({useGoogleMaps ? 'Google Maps' : 'OpenStreetMap'})
            </span>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block shrink-0"></span>
              <span className="text-slate-700">ปกติ / ติดสังคม</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-amber-500 inline-block shrink-0"></span>
              <span className="text-slate-700">ติดบ้าน / มีโรคเรื้อรัง</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-rose-500 inline-block shrink-0"></span>
              <span className="text-slate-700">ติดเตียง / พบลูกน้ำ</span>
            </div>
          </div>

          {!useGoogleMaps && showHeatMap && (
            <div className="pt-2 border-t border-slate-200/80 space-y-1">
              <span className="font-bold text-slate-800 block text-[11px]">
                ความหนาแน่น ({HEAT_METRIC_CONFIG[heatMetric].shortLabel})
              </span>
              <div
                className="h-2.5 w-full rounded-full"
                style={{
                  background:
                    'linear-gradient(to right, #22c55e, #eab308, #f97316, #dc2626)',
                }}
              />
              <div className="flex justify-between text-[10px] text-slate-500 font-medium">
                <span>น้อย</span>
                <span>ปานกลาง</span>
                <span>หนาแน่นสูง</span>
              </div>
            </div>
          )}
        </div>

        {/* Clicked Coords Action Box */}
        {clickedCoords && (
          <div className="absolute top-4 right-4 z-[400] bg-white/95 backdrop-blur-xs p-3.5 rounded-xl shadow-lg border border-emerald-300 max-w-xs">
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1">
                <Navigation className="w-3.5 h-3.5 text-emerald-600" />
                จุดที่เลือกบนแผนที่
              </span>
              <button
                type="button"
                onClick={() => setClickedCoords(null)}
                className="text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="text-[11px] font-mono text-slate-600 mt-1">
              Lat: {clickedCoords.lat.toFixed(6)}, Lng: {clickedCoords.lng.toFixed(6)}
            </div>
            <button
              type="button"
              onClick={() => {
                onAddHouseholdAtCoords(clickedCoords.lat, clickedCoords.lng);
                setClickedCoords(null);
              }}
              className="mt-2.5 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-xs cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>เพิ่มหลังคาเรือนที่พิกัดนี้</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
