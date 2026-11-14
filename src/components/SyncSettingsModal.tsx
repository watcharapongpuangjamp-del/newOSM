import React, { useState, useEffect } from 'react';
import {
  X,
  RefreshCw,
  ShieldCheck,
  Database,
  History,
  AlertTriangle,
  RotateCcw,
  CheckCircle2,
  Lock,
  Check,
  Server,
  Smartphone,
  ChevronDown,
  GitCompare,
  LogIn,
  LogOut,
  Cloud,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import { storage } from '../services/storage';
import {
  getFirebaseProjectId,
  getFirestoreDatabaseId,
  signInWithGoogleAccount,
  signOutFirebase,
} from '../services/firebase';
import {
  syncWithFirestore,
  type CloudSyncResult,
  type SyncConflict,
} from '../services/cloudSync';
import { Household, Person, HealthScreening, Tombstone, AuditLog } from '../types';
import { motion, AnimatePresence } from 'framer-motion';
import { useDrag } from '@use-gesture/react';

interface SyncSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onResetData: () => void;
  onClearData: () => void;
  onDataReload: () => Promise<void>;
  firebaseUser: User | null;
  households: Household[];
  persons: Person[];
  screenings: HealthScreening[];
  tombstones: Tombstone[];
  logs: AuditLog[];
}

export const SyncSettingsModal: React.FC<SyncSettingsModalProps> = ({
  isOpen,
  onClose,
  onResetData,
  onClearData,
  onDataReload,
  firebaseUser,
  households,
  persons,
  screenings,
  tombstones,
  logs,
}) => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [syncResult, setSyncResult] = useState<CloudSyncResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [resolveChoices, setResolveChoices] = useState<Record<string, 'local' | 'server'>>({});
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [pendingQueueCount, setPendingQueueCount] = useState(0);
  const [dragY, setDragY] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    storage
      .getSyncQueue()
      .then((q) => setPendingQueueCount(q.length))
      .catch(() => setPendingQueueCount(0));
  }, [isOpen, syncResult]);

  const bindDrag = useDrag(
    ({ down, movement: [, my] }) => {
      if (my > 0) {
        setDragY(down ? my : 0);
        if (!down && my > 100) {
          onClose();
        }
      }
    },
    { filterTaps: true }
  );

  if (!isOpen) return null;

  const handleGoogleSignIn = async () => {
    setIsSigningIn(true);
    setSyncError(null);
    try {
      const user = await signInWithGoogleAccount();
      if (user) {
        await handleTriggerSync(user);
      }
    } catch (err: any) {
      console.error('Google Sign-In failed:', err);
      const code = err?.code || '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setSyncError('ยกเลิกการเข้าสู่ระบบด้วย Google กรุณาลองใหม่อีกครั้ง');
      } else {
        setSyncError(err?.message || 'เข้าสู่ระบบ Google ไม่สำเร็จ');
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleGoogleSignOut = async () => {
    setSyncError(null);
    setSyncResult(null);
    await signOutFirebase();
  };

  const handleTriggerSync = async (
    targetUser: User | null = firebaseUser,
    overrides?: Record<string, 'local' | 'server'>
  ) => {
    if (!targetUser) {
      setSyncError('กรุณาเข้าสู่ระบบด้วยบัญชี Google ก่อนซิงค์ข้อมูลกับ Cloud Firestore');
      return;
    }

    setIsSyncing(true);
    setSyncError(null);
    try {
      const result = await syncWithFirestore(targetUser, {
        resolveChoices: overrides || resolveChoices,
      });
      setSyncResult(result);

      if (result.conflicts.length > 0) {
        setConflicts(result.conflicts);
        setShowConflictModal(true);
      } else {
        setConflicts([]);
        setShowConflictModal(false);
        setResolveChoices({});
      }

      await onDataReload();
      const q = await storage.getSyncQueue();
      setPendingQueueCount(q.length);
    } catch (err: any) {
      console.error('Firestore sync error:', err);
      setSyncError(
        err?.message || 'เกิดข้อผิดพลาดระหว่างซิงค์ข้อมูลกับ Cloud Firestore กรุณาตรวจสอบอินเทอร์เน็ตและสิทธิ์ผู้ใช้'
      );
    } finally {
      setIsSyncing(false);
    }
  };

  const handleResolveConflict = async (conflictId: string, choice: 'local' | 'server') => {
    const updatedChoices = { ...resolveChoices, [conflictId]: choice };
    setResolveChoices(updatedChoices);
    const remaining = conflicts.filter((c) => c.id !== conflictId);
    setConflicts(remaining);

    await storage.log(
      'sync',
      'firestore',
      `เลือกใช้ข้อมูลฝั่ง ${choice === 'local' ? 'เครื่องท้องถิ่น' : 'Cloud Server'} สำหรับรายการ ${conflictId}`
    );

    if (remaining.length === 0) {
      setShowConflictModal(false);
      await handleTriggerSync(firebaseUser, updatedChoices);
    }
  };

  const handleReset = () => {
    if (
      confirm(
        'ต้องการคืนค่าข้อมูลระบบสู่ค่าเริ่มต้นการสาธิตหรือไม่? (ข้อมูลที่เพิ่มใหม่จะถูกรีเซ็ต)'
      )
    ) {
      onResetData();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        style={{ y: dragY }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-2xl my-8 overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Drag Indicator handle for mobile swipe-to-dismiss */}
        <div
          {...bindDrag()}
          className="w-full pt-3 pb-1 flex justify-center cursor-grab active:cursor-grabbing bg-slate-50 border-b border-slate-100 md:hidden"
        >
          <div className="w-12 h-1.5 bg-slate-300 rounded-full flex items-center justify-center">
            <ChevronDown className="w-4 h-4 text-slate-400" />
          </div>
        </div>

        {/* Header */}
        <div className="px-6 py-4 bg-emerald-700 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-200" />
            <h2 className="text-lg font-bold">การเชื่อมต่อ Cloud Firestore & ความปลอดภัยข้อมูล</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-emerald-200 hover:text-white hover:bg-emerald-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Firebase Account & Sync Status Banner */}
          <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-200 space-y-4 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                {firebaseUser?.photoURL ? (
                  <img
                    src={firebaseUser.photoURL}
                    alt={firebaseUser.displayName || 'User'}
                    className="w-11 h-11 rounded-xl border border-emerald-300 shadow-sm shrink-0"
                  />
                ) : (
                  <div className="p-2.5 bg-emerald-600 text-white rounded-xl mt-0.5 shadow-sm shrink-0">
                    <Cloud className={`w-5 h-5 ${isSyncing ? 'animate-pulse' : ''}`} />
                  </div>
                )}
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-slate-900 text-sm">
                      {firebaseUser
                        ? `เชื่อมต่อบัญชี: ${firebaseUser.displayName || firebaseUser.email}`
                        : 'โหมดออฟไลน์ในเครื่อง (ยังไม่ได้เชื่อมบัญชี Google)'}
                    </span>
                    <span
                      className={`w-2.5 h-2.5 rounded-full ${
                        firebaseUser ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400'
                      }`}
                    ></span>
                  </div>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    {firebaseUser ? (
                      <>
                        {firebaseUser.email} • คิวรอซิงค์ในเครื่อง: <strong>{pendingQueueCount}</strong> รายการ
                      </>
                    ) : (
                      'เข้าสู่ระบบด้วยบัญชี Google เพื่อสำรองและซิงค์ข้อมูลครัวเรือน ประชากร และการคัดกรองขึ้น Firebase Cloud Firestore อย่างปลอดภัย'
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 self-start sm:self-auto shrink-0 flex-wrap">
                {firebaseUser ? (
                  <>
                    <button
                      type="button"
                      data-testid="sync_now_button"
                      onClick={() => void handleTriggerSync(firebaseUser)}
                      disabled={isSyncing}
                      className="flex items-center justify-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition-colors disabled:opacity-50 shadow-xs"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                      <span>{isSyncing ? 'กำลังซิงค์...' : 'ซิงค์กับ Cloud ตอนนี้'}</span>
                    </button>
                    <button
                      type="button"
                      data-testid="google_signout_button"
                      onClick={() => void handleGoogleSignOut()}
                      disabled={isSyncing}
                      className="flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-semibold transition-colors"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>ออกจากระบบ</span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    data-testid="google_signin_button"
                    onClick={() => void handleGoogleSignIn()}
                    disabled={isSigningIn}
                    className="flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors disabled:opacity-50 shadow-sm"
                  >
                    <LogIn className="w-4 h-4" />
                    <span>{isSigningIn ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบด้วย Google'}</span>
                  </button>
                )}
              </div>
            </div>

            <div className="text-[11px] text-slate-500 bg-white/80 rounded-xl px-3 py-2 border border-emerald-100 flex flex-wrap items-center justify-between gap-2">
              <span>
                Project: <code className="font-mono text-slate-700">{getFirebaseProjectId()}</code>
              </span>
              <span>
                Firestore DB:{' '}
                <code className="font-mono text-slate-700">{getFirestoreDatabaseId()}</code>
              </span>
            </div>
          </div>

          {syncError && (
            <div
              role="alert"
              className="p-3 bg-rose-50 text-rose-800 text-xs rounded-xl flex items-start gap-2 font-medium border border-rose-200"
            >
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{syncError}</span>
            </div>
          )}

          {syncResult && syncResult.conflicts.length === 0 && !syncError && (
            <div className="p-3 bg-emerald-100 text-emerald-800 text-xs rounded-xl flex items-center gap-2 font-medium border border-emerald-200">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>
                ซิงค์ข้อมูลกับ Cloud Firestore เรียบร้อยแล้ว (ส่งขึ้น {syncResult.pushedCount}, ดึงลง{' '}
                {syncResult.pulledCount}, ลบ {syncResult.deletedCount} รายการ)
              </span>
            </div>
          )}

          {/* Database & Storage Stats */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <Database className="w-4 h-4 text-slate-400" />
              <span>สถิติข้อมูลที่จัดเก็บในฐานข้อมูล SQLite ท้องถิ่น</span>
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 shadow-2xs">
                <span className="text-lg font-bold text-slate-800">{households.length}</span>
                <span className="text-xs text-slate-500 block">หลังคาเรือน</span>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 shadow-2xs">
                <span className="text-lg font-bold text-slate-800">{persons.length}</span>
                <span className="text-xs text-slate-500 block">ประชากร</span>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 shadow-2xs">
                <span className="text-lg font-bold text-slate-800">{screenings.length}</span>
                <span className="text-xs text-slate-500 block">คัดกรองสุขภาพ</span>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 shadow-2xs">
                <span className="text-lg font-bold text-slate-800">{tombstones.length}</span>
                <span className="text-xs text-slate-500 block">Tombstones (ลบ)</span>
              </div>
            </div>
          </div>

          {/* Security & Access Partitioning */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-2 shadow-2xs">
            <div className="flex items-center gap-2 text-slate-800 font-bold">
              <Lock className="w-4 h-4 text-emerald-600" />
              <span>การแยกสิทธิ์ข้อมูลระดับบัญชีผู้ใช้ (Zero-Trust User Isolation)</span>
            </div>
            <p className="text-slate-600 leading-relaxed">
              ข้อมูลทุกชุดบน Cloud Firestore ถูกแยกจัดเก็บเฉพาะบัญชีผู้ใช้ที่ยืนยันตัวตนผ่าน Google Sign-In
              ภายใต้เส้นทาง <code className="font-mono">/users/&#123;uid&#125;/...</code>{' '}
              พร้อมกฎความปลอดภัยที่ตรวจสอบสิทธิ์เจ้าของและโครงสร้างข้อมูลทุกครั้ง
            </p>
          </div>

          {/* Audit Trail Logs */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <History className="w-4 h-4 text-slate-400" />
              <span>บันทึกประวัติการเปลี่ยนแปลงระบบ (Audit Logs)</span>
            </h3>

            <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl bg-white text-xs shadow-2xs">
              {logs.slice(0, 15).map((log) => (
                <div key={log.id} className="p-2.5 flex items-center justify-between hover:bg-slate-50">
                  <div>
                    <span className="font-semibold text-slate-800">{log.details}</span>
                    <span className="text-slate-400 text-[11px] ml-2">({log.user})</span>
                  </div>
                  <span className="text-[11px] text-slate-400 shrink-0 font-mono">
                    {new Date(log.timestamp).toLocaleTimeString('th-TH')}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Danger Zone: Reset */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-between">
            <div>
              <span className="text-xs font-bold text-slate-700 block">คืนค่าข้อมูลตั้งต้นระบบ</span>
              <span className="text-[11px] text-slate-500">
                ล้างข้อมูลและโหลดชุดข้อมูลตัวอย่างสาธิตใหม่อีกครั้ง
              </span>
            </div>
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-semibold transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>รีเซ็ตข้อมูลตัวอย่าง</span>
            </button>
          </div>

          <div className="pt-4 border-t border-slate-200 flex items-center justify-between">
            <div>
              <span className="text-xs font-bold text-rose-700 block">ล้างข้อมูลทั้งหมด (Clear All)</span>
              <span className="text-[11px] text-slate-500">
                ล้างข้อมูลทั้งหมดในเครื่องออกทันที โดยไม่โหลดค่าเริ่มต้น
              </span>
            </div>
            <button
              onClick={() => {
                if (confirm('ต้องการล้างข้อมูลทั้งหมดในเครื่องทันทีหรือไม่? (ไม่สามารถกู้คืนได้)')) {
                  onClearData();
                  onClose();
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold transition-colors shadow-sm"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>ล้างข้อมูลทั้งหมด</span>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-semibold transition-colors"
          >
            ปิด
          </button>
        </div>
      </motion.div>

      {/* Sync Conflict Resolution Side-by-Side Diff Modal Dialog */}
      <AnimatePresence>
        {showConflictModal && conflicts.length > 0 && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fadeIn overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-2xl shadow-2xl border border-amber-200 w-full max-w-3xl overflow-hidden flex flex-col my-8"
            >
              <div className="px-6 py-4 bg-amber-600 text-white flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <GitCompare className="w-5 h-5 text-amber-200" />
                  <h3 className="text-base font-bold">เครื่องมือเปรียบเทียบความขัดแย้งข้อมูล (Side-by-Side Diff)</h3>
                </div>
                <span className="text-xs bg-amber-700 px-2.5 py-1 rounded-lg font-mono">
                  {conflicts.length} รายการที่ต้องตรวจสอบ
                </span>
              </div>

              <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
                <div className="p-3.5 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900 leading-relaxed flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <strong>ตรวจพบความขัดแย้งการแก้ไขข้อมูล (Sync Conflict):</strong>{' '}
                    รายการด้านล่างถูกแก้ไขทั้งในอุปกรณ์ของคุณ (Local) และบน Cloud Server
                    โปรดเลือกเวอร์ชันที่ต้องการเก็บรักษา
                  </div>
                </div>

                {conflicts.map((conflict) => (
                  <div
                    key={conflict.id}
                    className="border border-slate-200 rounded-2xl p-5 space-y-4 bg-slate-50/60 shadow-xs"
                  >
                    <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                      <div>
                        <span className="font-bold text-slate-900 text-sm block">{conflict.title}</span>
                        <span className="text-[11px] text-slate-500 font-mono">ID: {conflict.id}</span>
                      </div>
                      <span className="text-xs font-semibold text-amber-700 bg-amber-100 px-2.5 py-1 rounded-lg border border-amber-200">
                        ต้องเลือกเวอร์ชัน
                      </span>
                    </div>

                    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-2xs">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-100 border-b border-slate-200 text-slate-700">
                            <th className="p-3 font-semibold w-1/4">ฟิลด์ข้อมูล</th>
                            <th className="p-3 font-semibold w-3/8 text-blue-700 bg-blue-50/50">
                              <div className="flex items-center gap-1.5">
                                <Smartphone className="w-3.5 h-3.5" />
                                <span>ในเครื่อง (Local) — {conflict.localTime}</span>
                              </div>
                            </th>
                            <th className="p-3 font-semibold w-3/8 text-emerald-700 bg-emerald-50/50">
                              <div className="flex items-center gap-1.5">
                                <Server className="w-3.5 h-3.5" />
                                <span>บน Cloud (Server) — {conflict.serverTime}</span>
                              </div>
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {conflict.diffFields.map((field, idx) => (
                            <tr
                              key={idx}
                              className={
                                field.isModified ? 'bg-amber-50/40 hover:bg-amber-50/80 transition' : 'hover:bg-slate-50'
                              }
                            >
                              <td className="p-3 font-semibold text-slate-700">{field.label}</td>
                              <td
                                className={`p-3 font-medium ${
                                  field.isModified
                                    ? 'bg-blue-50/70 text-blue-900 font-semibold border-l-2 border-blue-500'
                                    : 'text-slate-600'
                                }`}
                              >
                                {field.localValue}
                              </td>
                              <td
                                className={`p-3 font-medium ${
                                  field.isModified
                                    ? 'bg-emerald-50/70 text-emerald-900 font-semibold border-l-2 border-emerald-500'
                                    : 'text-slate-600'
                                }`}
                              >
                                {field.serverValue}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                      <button
                        onClick={() => void handleResolveConflict(conflict.id, 'local')}
                        className="py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-sm transition flex items-center justify-center gap-2"
                      >
                        <Check className="w-4 h-4" />
                        <span>เก็บข้อมูลในเครื่อง (Keep Local)</span>
                      </button>
                      <button
                        onClick={() => void handleResolveConflict(conflict.id, 'server')}
                        className="py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm transition flex items-center justify-center gap-2"
                      >
                        <Check className="w-4 h-4" />
                        <span>เก็บข้อมูลบน Cloud (Accept Server)</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex justify-between items-center text-xs text-slate-500">
                <span>ระบบจะบันทึกประวัติการเลือกความขัดแย้งลง Audit Logs โดยอัตโนมัติ</span>
                <button
                  onClick={() => setShowConflictModal(false)}
                  className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg font-semibold transition"
                >
                  ยกเลิก
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
