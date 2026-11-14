import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { X, QrCode, Download, Copy, Check, Printer, Home, User } from 'lucide-react';
import { Household, Person } from '../types';
import { buildHouseholdQrPayload, buildPersonQrPayload } from '../utils/qrCode';
import { formatThaiCitizenId } from '../utils/thaiId';

export type QrTarget =
  | { type: 'household'; household: Household }
  | { type: 'person'; person: Person; household?: Household };

interface QrCodeModalProps {
  isOpen: boolean;
  target: QrTarget | null;
  onClose: () => void;
}

export const QrCodeModal: React.FC<QrCodeModalProps> = ({ isOpen, target, onClose }) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);

  const payload =
    target?.type === 'household'
      ? buildHouseholdQrPayload(target.household)
      : target?.type === 'person'
      ? buildPersonQrPayload(target.person)
      : '';

  useEffect(() => {
    if (!isOpen || !payload) {
      setQrDataUrl('');
      return;
    }

    let cancelled = false;
    QRCode.toDataURL(payload, {
      width: 360,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#064e3b',
        light: '#ffffff',
      },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch((err) => {
        console.error('QR generation failed:', err);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, payload]);

  if (!isOpen || !target) return null;

  const title =
    target.type === 'household'
      ? `บ้านเลขที่ ${target.household.houseNo} หมู่ ${target.household.villageNo}`
      : `${target.person.title}${target.person.firstName} ${target.person.lastName}`;

  const subtitle =
    target.type === 'household'
      ? `เจ้าบ้าน: ${target.household.headOfHouseholdName} • ${target.household.villageName}`
      : `เลขบัตร: ${formatThaiCitizenId(target.person.citizenId)}${
          target.household ? ` • บ้านเลขที่ ${target.household.houseNo}` : ''
        }`;

  const entityId = target.type === 'household' ? target.household.id : target.person.id;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback ignored
    }
  };

  const handleDownloadPng = async () => {
    if (!qrDataUrl) return;

    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 580;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // White card background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Emerald header banner
    ctx.fillStyle = '#047857';
    ctx.fillRect(0, 0, canvas.width, 84);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Smart OSM Next • บัตรประจำตัว QR', canvas.width / 2, 38);

    ctx.fillStyle = '#a7f3d0';
    ctx.font = '14px sans-serif';
    ctx.fillText(
      target.type === 'household' ? 'ป้ายรหัสหลังคาเรือน (Household ID)' : 'บัตรรหัสประจำตัวประชากร (Person ID)',
      canvas.width / 2,
      64
    );

    // Draw QR image
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 80, 108, 320, 320);

      // Footer text
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText(title, canvas.width / 2, 468);

      ctx.fillStyle = '#475569';
      ctx.font = '14px sans-serif';
      ctx.fillText(subtitle, canvas.width / 2, 498);

      ctx.fillStyle = '#64748b';
      ctx.font = '13px monospace';
      ctx.fillText(`ID: ${entityId}`, canvas.width / 2, 534);

      const link = document.createElement('a');
      link.download = `smartosm-${entityId}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    };
    img.src = qrDataUrl;
  };

  const handlePrint = () => {
    if (!qrDataUrl) return;
    const printWin = window.open('', '_blank', 'width=480,height=640');
    if (!printWin) {
      // Fallback when popup is blocked (e.g. embedded WebView)
      handleDownloadPng();
      return;
    }
    printWin.document.write(`
      <!doctype html>
      <html lang="th">
        <head>
          <meta charset="UTF-8" />
          <title>พิมพ์ QR Code - ${title}</title>
          <style>
            body { font-family: 'Sarabun', sans-serif; display: flex; justify-content: center; padding: 24px; background: #fff; }
            .card { border: 2px solid #047857; border-radius: 16px; width: 320px; overflow: hidden; text-align: center; }
            .header { background: #047857; color: #fff; padding: 14px; }
            .header h1 { margin: 0; font-size: 16px; }
            .header p { margin: 4px 0 0; font-size: 12px; color: #d1fae5; }
            .body { padding: 20px; }
            .body img { width: 220px; height: 220px; }
            .title { font-size: 18px; font-weight: bold; margin: 10px 0 4px; color: #0f172a; }
            .sub { font-size: 13px; color: #475569; margin: 0; }
            .code { margin-top: 10px; font-family: monospace; font-size: 12px; color: #64748b; background: #f8fafc; padding: 4px 8px; border-radius: 6px; display: inline-block; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="header">
              <h1>Smart OSM Next</h1>
              <p>${target.type === 'household' ? 'รหัส QR หลังคาเรือน' : 'รหัส QR ประชากร'}</p>
            </div>
            <div class="body">
              <img src="${qrDataUrl}" alt="QR Code" />
              <div class="title">${title}</div>
              <p class="sub">${subtitle}</p>
              <div class="code">${payload}</div>
            </div>
          </div>
          <script>window.onload = () => { window.print(); };</script>
        </body>
      </html>
    `);
    printWin.document.close();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 bg-emerald-700 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <QrCode className="w-5 h-5 text-emerald-200" />
            <h2 className="text-base font-bold">
              {target.type === 'household' ? 'ป้าย QR ประจำหลังคาเรือน' : 'บัตร QR ประจำตัวประชากร'}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="ปิดหน้าต่าง QR"
            className="p-1 rounded-lg text-emerald-200 hover:text-white hover:bg-emerald-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 text-center space-y-4">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-semibold">
            {target.type === 'household' ? <Home className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
            <span>{target.type === 'household' ? 'Household Unique ID' : 'Person Unique ID'}</span>
          </div>

          <div className="mx-auto w-60 h-60 p-3 bg-white rounded-2xl border-2 border-emerald-100 shadow-sm flex items-center justify-center">
            {qrDataUrl ? (
              <img src={qrDataUrl} alt={`QR Code สำหรับ ${title}`} className="w-full h-full object-contain" />
            ) : (
              <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
            )}
          </div>

          <div>
            <h3 className="text-lg font-bold text-slate-900">{title}</h3>
            <p className="text-xs text-slate-500 mt-1">{subtitle}</p>
            <div className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-mono text-slate-600">
              <span>{payload}</span>
              <button
                type="button"
                onClick={handleCopy}
                title="คัดลอกรหัส QR"
                className="text-emerald-700 hover:text-emerald-800"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 pt-2">
            <button
              type="button"
              onClick={handleDownloadPng}
              className="flex items-center justify-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition-colors shadow-xs cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>บันทึกภาพ PNG</span>
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center justify-center gap-1.5 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>พิมพ์บัตร QR</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
