import React, { useEffect, useRef, useState, useCallback } from 'react';
import jsQR from 'jsqr';
import {
  X,
  QrCode,
  Camera,
  SwitchCamera,
  Flashlight,
  FlashlightOff,
  Upload,
  Search,
  Home,
  User,
  MapPin,
  ClipboardList,
  Calendar,
  Eye,
  Edit,
  AlertCircle,
  CheckCircle2,
  RotateCcw,
  UserPlus,
  Bug,
  Users,
  History,
} from 'lucide-react';
import { Household, Person, VhvMember } from '../types';
import { resolveQrScanResult, QrScanResolution } from '../utils/qrCode';
import { calculateAge, formatThaiCitizenId } from '../utils/thaiId';
import { CARE_CATEGORY_CONFIG, evaluateBloodPressure } from '../utils/health';

interface QrScannerModalProps {
  isOpen: boolean;
  households: Household[];
  persons: Person[];
  vhvMembers: VhvMember[];
  onClose: () => void;
  onViewHouseholdDetail: (household: Household) => void;
  onEditHousehold: (household: Household) => void;
  onOpenMapAtHousehold: (household: Household) => void;
  onOpenScreening: (person: Person) => void;
  onOpenAppointments: (person: Person) => void;
  onEditPerson: (person: Person) => void;
  onRegisterPersonWithCitizenId: (citizenId: string) => void;
}

interface RecentScanItem {
  key: string;
  type: 'household' | 'person';
  id: string;
  label: string;
  sublabel: string;
}

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

export const QrScannerModal: React.FC<QrScannerModalProps> = ({
  isOpen,
  households,
  persons,
  vhvMembers,
  onClose,
  onViewHouseholdDetail,
  onEditHousehold,
  onOpenMapAtHousehold,
  onOpenScreening,
  onOpenAppointments,
  onEditPerson,
  onRegisterPersonWithCitizenId,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastScanTimestampRef = useRef<number>(0);

  const [cameraState, setCameraState] = useState<'starting' | 'active' | 'error' | 'paused'>('starting');
  const [cameraError, setCameraError] = useState<string>('');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const [manualInput, setManualInput] = useState('');
  const [scanResult, setScanResult] = useState<QrScanResolution | null>(null);
  const [recentScans, setRecentScans] = useState<RecentScanItem[]>(() => {
    try {
      const saved = sessionStorage.getItem('smart_osm_recent_qr_scans');
      return saved ? (JSON.parse(saved) as RecentScanItem[]) : [];
    } catch {
      return [];
    }
  });

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setHasTorch(false);
    setTorchOn(false);
  }, []);

  const handleDecodedText = useCallback(
    (rawText: string) => {
      const resolution = resolveQrScanResult(rawText, households, persons);
      setScanResult(resolution);
      setCameraState('paused');

      // Subtle tactile feedback on mobile devices
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          navigator.vibrate(resolution.status === 'not_found' ? [40, 40, 40] : 80);
        } catch {
          // Ignore vibrate errors
        }
      }

      if (resolution.status === 'matched_household') {
        const h = resolution.household;
        setRecentScans((prev) => {
          const item: RecentScanItem = {
            key: `h-${h.id}`,
            type: 'household',
            id: h.id,
            label: `บ้านเลขที่ ${h.houseNo} หมู่ ${h.villageNo}`,
            sublabel: h.headOfHouseholdName,
          };
          const next = [item, ...prev.filter((x) => x.key !== item.key)].slice(0, 5);
          try {
            sessionStorage.setItem('smart_osm_recent_qr_scans', JSON.stringify(next));
          } catch {
            // Ignore storage errors
          }
          return next;
        });
      } else if (resolution.status === 'matched_person') {
        const p = resolution.person;
        setRecentScans((prev) => {
          const item: RecentScanItem = {
            key: `p-${p.id}`,
            type: 'person',
            id: p.id,
            label: `${p.title}${p.firstName} ${p.lastName}`,
            sublabel: resolution.household ? `บ้าน ${resolution.household.houseNo}` : `หมู่ ${p.villageNo}`,
          };
          const next = [item, ...prev.filter((x) => x.key !== item.key)].slice(0, 5);
          try {
            sessionStorage.setItem('smart_osm_recent_qr_scans', JSON.stringify(next));
          } catch {
            // Ignore storage errors
          }
          return next;
        });
      }
    },
    [households, persons]
  );

  const startCamera = useCallback(async () => {
    stopCamera();
    setCameraError('');
    setCameraState('starting');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraState('error');
      setCameraError('เบราว์เซอร์หรืออุปกรณ์นี้ไม่รองรับการเปิดกล้องโดยตรง กรุณาอัปโหลดรูปภาพ QR หรือกรอกรหัสด้านล่าง');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack && typeof videoTrack.getCapabilities === 'function') {
        const capabilities = videoTrack.getCapabilities() as MediaTrackCapabilities & { torch?: boolean };
        setHasTorch(Boolean(capabilities?.torch));
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraState('active');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setCameraState('error');
      if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('notallowed')) {
        setCameraError('ไม่ได้รับอนุญาตให้ใช้งานกล้อง กรุณากดอนุญาตสิทธิ์กล้องในเบราว์เซอร์ หรือใช้วิธีอัปโหลดภาพ QR แทน');
      } else if (msg.toLowerCase().includes('notfound') || msg.toLowerCase().includes('device')) {
        setCameraError('ไม่พบกล้องบนอุปกรณ์นี้ กรุณาอัปโหลดรูปภาพ QR หรือกรอกรหัสประจำตัวด้านล่าง');
      } else {
        setCameraError(`ไม่สามารถเปิดกล้องได้ (${msg}) กรุณาอัปโหลดรูปภาพ QR หรือกรอกรหัสด้านล่าง`);
      }
    }
  }, [facingMode, stopCamera]);

  // Start / stop camera lifecycle based on modal open & active state
  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setScanResult(null);
      setManualInput('');
      return;
    }

    if (!scanResult) {
      startCamera();
    }

    return () => {
      stopCamera();
    };
  }, [isOpen, facingMode, scanResult, startCamera, stopCamera]);

  // Frame decoding loop when camera is active
  useEffect(() => {
    if (!isOpen || cameraState !== 'active' || scanResult) return;

    let cancelled = false;
    const BarcodeDetectorCtor = (window as unknown as {
      BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorLike;
    }).BarcodeDetector;
    const detector = BarcodeDetectorCtor
      ? new BarcodeDetectorCtor({ formats: ['qr_code'] })
      : null;

    const scanFrame = async (now: number) => {
      if (cancelled) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (video && canvas && video.readyState >= video.HAVE_ENOUGH_DATA && now - lastScanTimestampRef.current >= 120) {
        lastScanTimestampRef.current = now;
        const vw = video.videoWidth;
        const vh = video.videoHeight;

        if (vw > 0 && vh > 0) {
          // Try native BarcodeDetector first when supported
          if (detector) {
            try {
              const codes = await detector.detect(video);
              const firstCode = codes.find((c) => c.rawValue && c.rawValue.trim().length > 0);
              if (firstCode?.rawValue && !cancelled) {
                handleDecodedText(firstCode.rawValue);
                return;
              }
            } catch {
              // Fallback to jsQR below
            }
          }

          // Downscale to max 640px for fast jsQR decoding
          const scale = Math.min(1, 640 / vw);
          const cw = Math.round(vw * scale);
          const ch = Math.round(vh * scale);
          if (canvas.width !== cw) canvas.width = cw;
          if (canvas.height !== ch) canvas.height = ch;

          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(video, 0, 0, cw, ch);
            const imageData = ctx.getImageData(0, 0, cw, ch);
            const qr = jsQR(imageData.data, cw, ch, {
              inversionAttempts: 'dontInvert',
            });
            if (qr && qr.data && !cancelled) {
              handleDecodedText(qr.data);
              return;
            }
          }
        }
      }

      if (!cancelled) {
        rafRef.current = requestAnimationFrame(scanFrame);
      }
    };

    rafRef.current = requestAnimationFrame(scanFrame);

    return () => {
      cancelled = true;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isOpen, cameraState, scanResult, handleDecodedText]);

  const handleToggleTorch = async () => {
    const videoTrack = streamRef.current?.getVideoTracks()[0];
    if (!videoTrack || !hasTorch) return;
    const nextTorch = !torchOn;
    try {
      await videoTrack.applyConstraints({
        advanced: [{ torch: nextTorch } as MediaTrackConstraintSet],
      });
      setTorchOn(nextTorch);
    } catch {
      // Ignore unsupported torch errors
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 1024;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const decoded = jsQR(imageData.data, canvas.width, canvas.height, {
          inversionAttempts: 'attemptBoth',
        });
        if (decoded && decoded.data) {
          handleDecodedText(decoded.data);
        } else {
          setScanResult({
            status: 'not_found',
            rawText: 'ไม่พบ QR Code ที่อ่านได้ในภาพที่เลือก กรุณาลองภาพที่คมชัดขึ้น',
          });
          setCameraState('paused');
        }
      };
      if (typeof reader.result === 'string') {
        img.src = reader.result;
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleManualLookup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualInput.trim()) return;
    handleDecodedText(manualInput.trim());
  };

  const handleRescan = () => {
    setScanResult(null);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-2xl my-6 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-emerald-700 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-emerald-600/80">
              <QrCode className="w-5 h-5 text-emerald-100" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold">สแกน QR Code ระบุตัวตน</h2>
              <p className="text-[11px] text-emerald-100">
                ส่องกล้องที่ป้ายบ้านหรือบัตรประชากรเพื่อเปิดข้อมูลหลังคาเรือน / ประชากรทันที
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดหน้าต่างสแกน QR"
            className="p-1.5 rounded-lg text-emerald-200 hover:text-white hover:bg-emerald-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5">
          {!scanResult ? (
            <>
              {/* Live Camera Viewfinder */}
              <div className="relative w-full aspect-[4/3] sm:aspect-video bg-slate-950 rounded-2xl overflow-hidden border border-slate-200 shadow-inner flex items-center justify-center">
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  autoPlay
                  className={`w-full h-full object-cover ${cameraState === 'active' ? 'opacity-100' : 'opacity-0'}`}
                />
                <canvas ref={canvasRef} className="hidden" />

                {/* Scanning Overlay Guide */}
                {cameraState === 'active' && (
                  <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
                    <div className="relative w-52 h-52 sm:w-60 sm:h-60">
                      <span className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-emerald-400 rounded-tl-xl" />
                      <span className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-emerald-400 rounded-tr-xl" />
                      <span className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-emerald-400 rounded-bl-xl" />
                      <span className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-emerald-400 rounded-br-xl" />
                      <div className="absolute left-3 right-3 top-1/2 h-0.5 bg-emerald-400/90 shadow-[0_0_10px_#34d399] animate-pulse" />
                    </div>
                    <span className="mt-4 px-3 py-1 rounded-full bg-slate-900/75 text-white text-xs font-medium backdrop-blur-xs">
                      วาง QR Code ให้อยู่ในกรอบเพื่อสแกนอัตโนมัติ
                    </span>
                  </div>
                )}

                {/* Starting Loader */}
                {cameraState === 'starting' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-white space-y-3 p-6 text-center">
                    <div className="w-10 h-10 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                    <p className="text-sm font-medium text-emerald-100">กำลังเปิดกล้องอุปกรณ์...</p>
                  </div>
                )}

                {/* Camera Error State */}
                {cameraState === 'error' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-white space-y-3 p-6 text-center bg-slate-900/95">
                    <div className="p-3 rounded-full bg-amber-500/20 text-amber-300">
                      <Camera className="w-8 h-8" />
                    </div>
                    <p className="text-xs sm:text-sm text-slate-200 max-w-md leading-relaxed">
                      {cameraError}
                    </p>
                    <button
                      type="button"
                      onClick={startCamera}
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>ลองเปิดกล้องอีกครั้ง</span>
                    </button>
                  </div>
                )}

                {/* Top-Right Camera Controls */}
                {cameraState === 'active' && (
                  <div className="absolute top-3 right-3 flex items-center gap-2">
                    {hasTorch && (
                      <button
                        type="button"
                        onClick={handleToggleTorch}
                        title={torchOn ? 'ปิดไฟฉาย' : 'เปิดไฟฉาย'}
                        className={`p-2.5 rounded-xl backdrop-blur-md transition-colors cursor-pointer ${
                          torchOn
                            ? 'bg-amber-500 text-white'
                            : 'bg-slate-900/65 text-white hover:bg-slate-900/85'
                        }`}
                      >
                        {torchOn ? <FlashlightOff className="w-4 h-4" /> : <Flashlight className="w-4 h-4" />}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))}
                      title="สลับกล้องหน้า/หลัง"
                      className="p-2.5 rounded-xl bg-slate-900/65 hover:bg-slate-900/85 text-white backdrop-blur-md transition-colors cursor-pointer"
                    >
                      <SwitchCamera className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              {/* Action Fallback Row: Upload QR Image + Manual Lookup */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Upload Image */}
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-700">สแกนจากรูปภาพ QR</p>
                    <p className="text-[11px] text-slate-500 truncate">เลือกรูปถ่าย QR จากเครื่อง</p>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-semibold shrink-0 transition-colors cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>เลือกรูปภาพ</span>
                  </button>
                </div>

                {/* Manual ID Input */}
                <form
                  onSubmit={handleManualLookup}
                  className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 flex items-center gap-2"
                >
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={manualInput}
                      onChange={(e) => setManualInput(e.target.value)}
                      placeholder="กรอก ID หรือเลขบัตร 13 หลัก..."
                      className="w-full pl-8 pr-2.5 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-500 font-mono"
                    />
                  </div>
                  <button
                    type="submit"
                    className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shrink-0 transition-colors cursor-pointer"
                  >
                    ค้นหา
                  </button>
                </form>
              </div>
            </>
          ) : (
            /* Scan Result Panel */
            <div className="space-y-4">
              {scanResult.status === 'matched_household' && (
                <HouseholdMatchCard
                  household={scanResult.household}
                  persons={persons}
                  vhvMembers={vhvMembers}
                  matchedBy={scanResult.matchedBy}
                  onViewDetail={() => {
                    onClose();
                    onViewHouseholdDetail(scanResult.household);
                  }}
                  onOpenMap={() => {
                    onClose();
                    onOpenMapAtHousehold(scanResult.household);
                  }}
                  onEdit={() => {
                    onClose();
                    onEditHousehold(scanResult.household);
                  }}
                />
              )}

              {scanResult.status === 'matched_person' && (
                <PersonMatchCard
                  person={scanResult.person}
                  household={scanResult.household}
                  matchedBy={scanResult.matchedBy}
                  onScreening={() => {
                    onClose();
                    onOpenScreening(scanResult.person);
                  }}
                  onAppointments={() => {
                    onClose();
                    onOpenAppointments(scanResult.person);
                  }}
                  onEdit={() => {
                    onClose();
                    onEditPerson(scanResult.person);
                  }}
                  onViewHousehold={
                    scanResult.household
                      ? () => {
                          onClose();
                          onViewHouseholdDetail(scanResult.household!);
                        }
                      : undefined
                  }
                />
              )}

              {scanResult.status === 'not_found' && (
                <div className="p-5 bg-amber-50 rounded-2xl border border-amber-200 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-xl bg-amber-100 text-amber-700 shrink-0">
                      <AlertCircle className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-bold text-amber-900">ไม่พบข้อมูลที่ตรงกับ QR Code นี้ในระบบ</h3>
                      <p className="text-xs text-amber-800 mt-1 break-all font-mono bg-white/80 px-2.5 py-1.5 rounded-lg border border-amber-200/80">
                        {scanResult.rawText}
                      </p>
                      {scanResult.extractedCitizenId && (
                        <p className="text-xs text-emerald-800 mt-2 font-medium">
                          ตรวจพบเลขประจำตัวประชาชนที่ถูกต้อง ({formatThaiCitizenId(scanResult.extractedCitizenId)}) แต่ยังไม่ได้ลงทะเบียนในระบบ
                        </p>
                      )}
                    </div>
                  </div>

                  {scanResult.extractedCitizenId && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onRegisterPersonWithCitizenId(scanResult.extractedCitizenId!);
                      }}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                    >
                      <UserPlus className="w-4 h-4" />
                      <span>ลงทะเบียนประชากรใหม่ด้วยเลขบัตรนี้</span>
                    </button>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={handleRescan}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>สแกน QR Code รายการถัดไป</span>
              </button>
            </div>
          )}

          {/* Recent Scans */}
          {recentScans.length > 0 && (
            <div className="pt-3 border-t border-slate-100 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500">
                <History className="w-3.5 h-3.5" />
                <span>ประวัติการสแกนล่าสุดในเซสชันนี้</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {recentScans.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => handleDecodedText(item.id)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-50 hover:bg-emerald-50 border border-slate-200 hover:border-emerald-300 rounded-lg text-xs text-slate-700 transition-colors cursor-pointer"
                  >
                    {item.type === 'household' ? (
                      <Home className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <User className="w-3.5 h-3.5 text-blue-600" />
                    )}
                    <span className="font-semibold">{item.label}</span>
                    <span className="text-slate-400 text-[11px]">({item.sublabel})</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface HouseholdMatchCardProps {
  household: Household;
  persons: Person[];
  vhvMembers: VhvMember[];
  matchedBy: string;
  onViewDetail: () => void;
  onOpenMap: () => void;
  onEdit: () => void;
}

const HouseholdMatchCard: React.FC<HouseholdMatchCardProps> = ({
  household,
  persons,
  vhvMembers,
  matchedBy,
  onViewDetail,
  onOpenMap,
  onEdit,
}) => {
  const memberCount = persons.filter((p) => p.householdId === household.id).length;
  const vhv = vhvMembers.find((v) => v.id === household.vhvMemberId);

  return (
    <div className="p-5 bg-emerald-50/70 rounded-2xl border border-emerald-200 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-600 text-white shadow-xs shrink-0">
            <Home className="w-5 h-5" />
          </div>
          <div>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-white px-2 py-0.5 rounded-full border border-emerald-200 mb-1">
              <CheckCircle2 className="w-3 h-3" />
              <span>พบข้อมูลหลังคาเรือน ({matchedBy})</span>
            </span>
            <h3 className="text-lg font-bold text-slate-900">
              บ้านเลขที่ {household.houseNo} หมู่ {household.villageNo}
            </h3>
            <p className="text-xs text-slate-600">
              {household.villageName} ต.{household.subdistrict} อ.{household.district} จ.{household.province}
            </p>
          </div>
        </div>

        {household.mosquitoLarvaFound ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full bg-rose-100 text-rose-700 border border-rose-200 shrink-0">
            <Bug className="w-3.5 h-3.5" />
            <span>พบลูกน้ำ</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-full bg-white text-emerald-700 border border-emerald-200 shrink-0">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>ปลอดลูกน้ำ</span>
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
        <div className="p-2.5 bg-white rounded-xl border border-emerald-100">
          <span className="text-slate-500 block">เจ้าบ้าน</span>
          <span className="font-bold text-slate-800">{household.headOfHouseholdName}</span>
        </div>
        <div className="p-2.5 bg-white rounded-xl border border-emerald-100">
          <span className="text-slate-500 block">สมาชิกในบ้าน</span>
          <span className="font-bold text-emerald-700 inline-flex items-center gap-1">
            <Users className="w-3.5 h-3.5" />
            {memberCount} คน
          </span>
        </div>
        <div className="p-2.5 bg-white rounded-xl border border-emerald-100">
          <span className="text-slate-500 block">อสม. ผู้ดูแล</span>
          <span className="font-bold text-slate-800">{vhv ? vhv.name : 'ไม่ระบุ'}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={onViewDetail}
          className="flex-1 min-w-[160px] flex items-center justify-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition-colors shadow-xs cursor-pointer"
        >
          <Eye className="w-4 h-4" />
          <span>ดูสมาชิก & รายละเอียดบ้าน</span>
        </button>
        <button
          type="button"
          onClick={onOpenMap}
          className="flex items-center justify-center gap-1.5 px-3.5 py-2.5 bg-white hover:bg-slate-50 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
        >
          <MapPin className="w-4 h-4" />
          <span>แผนที่ GIS</span>
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="flex items-center justify-center gap-1.5 px-3.5 py-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
        >
          <Edit className="w-4 h-4" />
          <span>แก้ไข</span>
        </button>
      </div>
    </div>
  );
};

interface PersonMatchCardProps {
  person: Person;
  household?: Household;
  matchedBy: string;
  onScreening: () => void;
  onAppointments: () => void;
  onEdit: () => void;
  onViewHousehold?: () => void;
}

const PersonMatchCard: React.FC<PersonMatchCardProps> = ({
  person,
  household,
  matchedBy,
  onScreening,
  onAppointments,
  onEdit,
  onViewHousehold,
}) => {
  const age = calculateAge(person.birthDate);
  const careConfig = CARE_CATEGORY_CONFIG[person.careCategory];
  const bpEval = evaluateBloodPressure(person.systolic, person.diastolic);

  return (
    <div className="p-5 bg-blue-50/60 rounded-2xl border border-blue-200 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-blue-600 text-white shadow-xs shrink-0">
            <User className="w-5 h-5" />
          </div>
          <div>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 bg-white px-2 py-0.5 rounded-full border border-blue-200 mb-1">
              <CheckCircle2 className="w-3 h-3" />
              <span>พบข้อมูลประชากร ({matchedBy})</span>
            </span>
            <h3 className="text-lg font-bold text-slate-900">
              {person.title}
              {person.firstName} {person.lastName}
            </h3>
            <p className="text-xs text-slate-600 font-mono">
              เลขบัตร: {formatThaiCitizenId(person.citizenId)}
            </p>
          </div>
        </div>

        <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full shrink-0 ${careConfig.badgeClass}`}>
          {careConfig.shortLabel}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
        <div className="p-2.5 bg-white rounded-xl border border-blue-100">
          <span className="text-slate-500 block">อายุ / เพศ / หมู่เลือด</span>
          <span className="font-bold text-slate-800">
            {age} ปี • {person.gender === 'male' ? 'ชาย' : 'หญิง'} ({person.bloodGroup})
          </span>
        </div>
        <div className="p-2.5 bg-white rounded-xl border border-blue-100">
          <span className="text-slate-500 block">ที่อยู่</span>
          <span className="font-bold text-slate-800">
            บ้านเลขที่ {household?.houseNo || '-'} หมู่ {person.villageNo}
          </span>
        </div>
        <div className="p-2.5 bg-white rounded-xl border border-blue-100">
          <span className="text-slate-500 block">สัญญาณชีพล่าสุด</span>
          <span className={`font-bold ${bpEval?.colorClass || 'text-slate-800'}`}>
            {person.systolic && person.diastolic
              ? `BP ${person.systolic}/${person.diastolic}`
              : 'ยังไม่เคยตรวจ BP'}
            {person.bloodSugarDtx ? ` • DTX ${person.bloodSugarDtx}` : ''}
          </span>
        </div>
      </div>

      {person.chronicDiseases.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {person.chronicDiseases.map((d, i) => (
            <span
              key={i}
              className="text-[11px] px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 font-medium"
            >
              {d}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={onScreening}
          className="flex-1 min-w-[150px] flex items-center justify-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition-colors shadow-xs cursor-pointer"
        >
          <ClipboardList className="w-4 h-4" />
          <span>บันทึกคัดกรองสุขภาพ</span>
        </button>
        <button
          type="button"
          onClick={onAppointments}
          className="flex items-center justify-center gap-1.5 px-3.5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer"
        >
          <Calendar className="w-4 h-4" />
          <span>นัดหมาย</span>
        </button>
        {onViewHousehold && (
          <button
            type="button"
            onClick={onViewHousehold}
            className="flex items-center justify-center gap-1.5 px-3.5 py-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
          >
            <Home className="w-4 h-4" />
            <span>ดูครัวเรือน</span>
          </button>
        )}
        <button
          type="button"
          onClick={onEdit}
          className="flex items-center justify-center gap-1.5 px-3.5 py-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
        >
          <Edit className="w-4 h-4" />
          <span>แก้ไข</span>
        </button>
      </div>
    </div>
  );
};
