import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  type DocumentData,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { getFirebaseDb } from './firebase';
import { storage } from './storage';
import type {
  Appointment,
  HealthScreening,
  Household,
  Person,
  Tombstone,
  VhvMember,
} from '../types';

export interface DiffField {
  label: string;
  localValue: string;
  serverValue: string;
  isModified: boolean;
}

export interface SyncConflict {
  id: string;
  collection: 'households' | 'persons' | 'appointments' | 'vhv_members';
  title: string;
  localTime: string;
  serverTime: string;
  diffFields: DiffField[];
  localRecord: Record<string, unknown>;
  serverRecord: Record<string, unknown>;
}

export interface CloudSyncResult {
  pushedCount: number;
  pulledCount: number;
  deletedCount: number;
  conflicts: SyncConflict[];
  syncedAt: string;
  error?: string;
}

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

function isValidFirestoreId(id: string): boolean {
  return VALID_ID_REGEX.test(id);
}

function cleanObject<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val !== undefined) {
      result[key] = val;
    }
  }
  return result;
}

function stripServerFields<T>(data: DocumentData): T {
  const { serverCreatedAt: _sc, serverUpdatedAt: _su, ...rest } = data;
  return rest as T;
}

function toTimestampMs(isoOrDate?: string): number {
  if (!isoOrDate) return 0;
  const ms = Date.parse(isoOrDate);
  return Number.isNaN(ms) ? 0 : ms;
}

function formatTimeShort(iso?: string): string {
  const ms = toTimestampMs(iso);
  if (!ms) return '-';
  return new Date(ms).toLocaleString('th-TH', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function normalizeHouseholdForCloud(h: Household): Record<string, unknown> {
  return cleanObject({
    id: h.id,
    houseNo: String(h.houseNo || '-').slice(0, 60),
    villageNo: Math.max(0, Math.min(999, Math.round(Number(h.villageNo) || 0))),
    villageName: String(h.villageName || '').slice(0, 150),
    subdistrict: String(h.subdistrict || '').slice(0, 150),
    district: String(h.district || '').slice(0, 150),
    province: String(h.province || '').slice(0, 150),
    latitude: Number.isFinite(Number(h.latitude)) ? Number(h.latitude) : 0,
    longitude: Number.isFinite(Number(h.longitude)) ? Number(h.longitude) : 0,
    headOfHouseholdName: String(h.headOfHouseholdName || '').slice(0, 150),
    vhvMemberId: String(h.vhvMemberId || '').slice(0, 128),
    sanitationRating: (['good', 'fair', 'poor'].includes(h.sanitationRating) ? h.sanitationRating : 'good'),
    mosquitoLarvaFound: Boolean(h.mosquitoLarvaFound),
    waterSource: String(h.waterSource || '').slice(0, 150),
    wasteManagement: String(h.wasteManagement || '').slice(0, 150),
    notes: h.notes != null ? String(h.notes).slice(0, 2000) : null,
    createdAt: h.createdAt || new Date().toISOString(),
    updatedAt: h.updatedAt || h.createdAt || new Date().toISOString(),
  });
}

function normalizePersonForCloud(p: Person): Record<string, unknown> {
  return cleanObject({
    id: p.id,
    householdId: String(p.householdId || 'unknown').slice(0, 128),
    villageNo: Math.max(0, Math.min(999, Math.round(Number(p.villageNo) || 0))),
    citizenId: String(p.citizenId || '').slice(0, 20),
    title: String(p.title || '').slice(0, 30),
    firstName: String(p.firstName || '-').slice(0, 100),
    lastName: String(p.lastName || '-').slice(0, 100),
    gender: p.gender === 'female' ? 'female' : 'male',
    birthDate: String(p.birthDate || '').slice(0, 40),
    birthDatePrecision: p.birthDatePrecision === 'year' || p.birthDatePrecision === 'full' ? p.birthDatePrecision : null,
    bloodGroup: (['A', 'B', 'AB', 'O', 'Rh-', 'Unknown'].includes(p.bloodGroup) ? p.bloodGroup : 'Unknown'),
    phone: p.phone != null ? String(p.phone).slice(0, 30) : null,
    occupation: p.occupation != null ? String(p.occupation).slice(0, 150) : null,
    residentStatus: (['resident', 'moved_out', 'deceased', 'temporary'].includes(p.residentStatus)
      ? p.residentStatus
      : 'resident'),
    careCategory: (['active', 'homebound', 'bedridden'].includes(p.careCategory) ? p.careCategory : 'active'),
    chronicDiseases: Array.isArray(p.chronicDiseases) ? p.chronicDiseases.slice(0, 30).map(String) : [],
    weightKg: p.weightKg != null && Number.isFinite(Number(p.weightKg)) ? Number(p.weightKg) : null,
    heightCm: p.heightCm != null && Number.isFinite(Number(p.heightCm)) ? Number(p.heightCm) : null,
    bmi: p.bmi != null && Number.isFinite(Number(p.bmi)) ? Number(p.bmi) : null,
    systolic: p.systolic != null && Number.isFinite(Number(p.systolic)) ? Number(p.systolic) : null,
    diastolic: p.diastolic != null && Number.isFinite(Number(p.diastolic)) ? Number(p.diastolic) : null,
    bloodSugarDtx: p.bloodSugarDtx != null && Number.isFinite(Number(p.bloodSugarDtx)) ? Number(p.bloodSugarDtx) : null,
    createdAt: p.createdAt || new Date().toISOString(),
    updatedAt: p.updatedAt || p.createdAt || new Date().toISOString(),
  });
}

function normalizeScreeningForCloud(s: HealthScreening): Record<string, unknown> {
  return cleanObject({
    id: s.id,
    personId: String(s.personId || 'unknown').slice(0, 128),
    householdId: String(s.householdId || 'unknown').slice(0, 128),
    villageNo: Math.max(0, Math.min(999, Math.round(Number(s.villageNo) || 0))),
    date: String(s.date || '').slice(0, 40),
    vhvMemberId: String(s.vhvMemberId || '').slice(0, 128),
    weightKg: Number.isFinite(Number(s.weightKg)) ? Number(s.weightKg) : 0,
    heightCm: Number.isFinite(Number(s.heightCm)) ? Number(s.heightCm) : 0,
    bmi: Number.isFinite(Number(s.bmi)) ? Number(s.bmi) : 0,
    systolic: Number.isFinite(Number(s.systolic)) ? Number(s.systolic) : 0,
    diastolic: Number.isFinite(Number(s.diastolic)) ? Number(s.diastolic) : 0,
    pulse: s.pulse != null && Number.isFinite(Number(s.pulse)) ? Number(s.pulse) : null,
    bloodSugarDtx: s.bloodSugarDtx != null && Number.isFinite(Number(s.bloodSugarDtx)) ? Number(s.bloodSugarDtx) : null,
    waistCm: s.waistCm != null && Number.isFinite(Number(s.waistCm)) ? Number(s.waistCm) : null,
    smoker: Boolean(s.smoker),
    alcohol: Boolean(s.alcohol),
    notes: s.notes != null ? String(s.notes).slice(0, 2000) : null,
    advice: s.advice != null ? String(s.advice).slice(0, 2000) : null,
    needDoctorReferral: Boolean(s.needDoctorReferral),
    createdAt: s.createdAt || new Date().toISOString(),
  });
}

function normalizeAppointmentForCloud(a: Appointment): Record<string, unknown> {
  return cleanObject({
    id: a.id,
    personId: String(a.personId || 'unknown').slice(0, 128),
    householdId: String(a.householdId || 'unknown').slice(0, 128),
    villageNo: Math.max(0, Math.min(999, Math.round(Number(a.villageNo) || 0))),
    vhvMemberId: String(a.vhvMemberId || '').slice(0, 128),
    title: String(a.title || '-').slice(0, 200),
    type: (['home_visit', 'vitals_check', 'hospital_visit', 'vaccine', 'larva_survey', 'other'].includes(a.type)
      ? a.type
      : 'other'),
    date: String(a.date || '').slice(0, 40),
    time: a.time != null ? String(a.time).slice(0, 20) : null,
    location: String(a.location || '').slice(0, 200),
    status: (['upcoming', 'completed', 'missed', 'cancelled'].includes(a.status) ? a.status : 'upcoming'),
    notes: a.notes != null ? String(a.notes).slice(0, 2000) : null,
    createdAt: a.createdAt || new Date().toISOString(),
    updatedAt: a.updatedAt || a.createdAt || new Date().toISOString(),
  });
}

function normalizeVhvForCloud(m: VhvMember): Record<string, unknown> {
  return cleanObject({
    id: m.id,
    name: String(m.name || '-').slice(0, 150),
    citizenId: String(m.citizenId || '').slice(0, 20),
    phone: String(m.phone || '').slice(0, 30),
    villageNo: Math.max(0, Math.min(999, Math.round(Number(m.villageNo) || 0))),
    zoneName: String(m.zoneName || '').slice(0, 200),
    assignedHouseIds: Array.isArray(m.assignedHouseIds) ? m.assignedHouseIds.slice(0, 500).map(String) : [],
    isActive: Boolean(m.isActive),
    registeredDate: String(m.registeredDate || '').slice(0, 40),
  });
}

function buildHouseholdDiff(localH: Household, remoteH: Household): DiffField[] {
  const fields: Array<{ label: string; localVal: string; remoteVal: string }> = [
    { label: 'หัวหน้าครัวเรือน', localVal: localH.headOfHouseholdName || '-', remoteVal: remoteH.headOfHouseholdName || '-' },
    { label: 'คะแนนสุขาภิบาล', localVal: localH.sanitationRating, remoteVal: remoteH.sanitationRating },
    {
      label: 'ลูกน้ำยุงลาย',
      localVal: localH.mosquitoLarvaFound ? 'พบ (Found)' : 'ไม่พบ',
      remoteVal: remoteH.mosquitoLarvaFound ? 'พบ (Found)' : 'ไม่พบ',
    },
    { label: 'แหล่งน้ำ', localVal: localH.waterSource || '-', remoteVal: remoteH.waterSource || '-' },
    { label: 'หมายเหตุ', localVal: localH.notes || '-', remoteVal: remoteH.notes || '-' },
  ];
  return fields.map((f) => ({
    label: f.label,
    localValue: f.localVal,
    serverValue: f.remoteVal,
    isModified: f.localVal !== f.remoteVal,
  }));
}

function buildPersonDiff(localP: Person, remoteP: Person): DiffField[] {
  const fields: Array<{ label: string; localVal: string; remoteVal: string }> = [
    {
      label: 'ชื่อ-สกุล',
      localVal: `${localP.title}${localP.firstName} ${localP.lastName}`,
      remoteVal: `${remoteP.title}${remoteP.firstName} ${remoteP.lastName}`,
    },
    { label: 'กลุ่มดูแล (3 ติด)', localVal: localP.careCategory, remoteVal: remoteP.careCategory },
    { label: 'สถานะการอยู่อาศัย', localVal: localP.residentStatus, remoteVal: remoteP.residentStatus },
    {
      label: 'โรคประจำตัว',
      localVal: (localP.chronicDiseases || []).join(', ') || '-',
      remoteVal: (remoteP.chronicDiseases || []).join(', ') || '-',
    },
    {
      label: 'ความดัน/DTX',
      localVal: `${localP.systolic ?? '-'}/${localP.diastolic ?? '-'} | DTX: ${localP.bloodSugarDtx ?? '-'}`,
      remoteVal: `${remoteP.systolic ?? '-'}/${remoteP.diastolic ?? '-'} | DTX: ${remoteP.bloodSugarDtx ?? '-'}`,
    },
  ];
  return fields.map((f) => ({
    label: f.label,
    localValue: f.localVal,
    serverValue: f.remoteVal,
    isModified: f.localVal !== f.remoteVal,
  }));
}

export async function ensureUserProfile(user: User): Promise<void> {
  const db = getFirebaseDb();
  const userRef = doc(db, 'users', user.uid);
  const existingSnap = await getDocs(collection(db, 'users', user.uid, 'households'));
  void existingSnap; // Keep import clean; use setDoc/updateDoc directly on userRef
  const profilePayload = cleanObject({
    uid: user.uid,
    displayName: (user.displayName || user.email || 'อสม. Smart OSM').slice(0, 150),
    email: user.email ? user.email.slice(0, 200) : null,
    photoURL: user.photoURL ? user.photoURL.slice(0, 500) : null,
  });

  try {
    await updateDoc(userRef, {
      ...profilePayload,
      serverUpdatedAt: serverTimestamp(),
    });
  } catch {
    await setDoc(userRef, {
      ...profilePayload,
      serverCreatedAt: serverTimestamp(),
      serverUpdatedAt: serverTimestamp(),
    });
  }
}

async function upsertDoc(
  userId: string,
  subcollection: string,
  docId: string,
  payload: Record<string, unknown>,
  existsInCloud: boolean
): Promise<void> {
  const db = getFirebaseDb();
  const ref = doc(db, 'users', userId, subcollection, docId);
  if (existsInCloud) {
    const { id: _omitId, createdAt: _omitCreated, ...updatable } = payload;
    await updateDoc(ref, {
      ...updatable,
      serverUpdatedAt: serverTimestamp(),
    });
  } else {
    await setDoc(ref, {
      ...payload,
      serverCreatedAt: serverTimestamp(),
      serverUpdatedAt: serverTimestamp(),
    });
  }
}

export async function syncWithFirestore(
  user: User,
  options?: { resolveChoices?: Record<string, 'local' | 'server'> }
): Promise<CloudSyncResult> {
  const db = getFirebaseDb();
  const resolveChoices = options?.resolveChoices || {};

  // Ensure user profile doc exists
  await ensureUserProfile(user);

  const [
    localHouseholds,
    localPersons,
    localScreenings,
    localAppointments,
    localVhv,
    localTombstones,
    syncQueue,
  ] = await Promise.all([
    storage.getHouseholds(),
    storage.getPersons(),
    storage.getScreenings(),
    storage.getAppointments(),
    storage.getVhvMembers(),
    storage.getTombstones(),
    storage.getSyncQueue(),
  ]);

  const [
    remoteHouseholdsSnap,
    remotePersonsSnap,
    remoteScreeningsSnap,
    remoteAppointmentsSnap,
    remoteVhvSnap,
    remoteTombstonesSnap,
  ] = await Promise.all([
    getDocs(collection(db, 'users', user.uid, 'households')),
    getDocs(collection(db, 'users', user.uid, 'persons')),
    getDocs(collection(db, 'users', user.uid, 'screenings')),
    getDocs(collection(db, 'users', user.uid, 'appointments')),
    getDocs(collection(db, 'users', user.uid, 'vhv_members')),
    getDocs(collection(db, 'users', user.uid, 'tombstones')),
  ]);

  const remoteHouseholds = new Map<string, Household>();
  remoteHouseholdsSnap.forEach((d) => remoteHouseholds.set(d.id, stripServerFields<Household>(d.data())));

  const remotePersons = new Map<string, Person>();
  remotePersonsSnap.forEach((d) => remotePersons.set(d.id, stripServerFields<Person>(d.data())));

  const remoteScreenings = new Map<string, HealthScreening>();
  remoteScreeningsSnap.forEach((d) => remoteScreenings.set(d.id, stripServerFields<HealthScreening>(d.data())));

  const remoteAppointments = new Map<string, Appointment>();
  remoteAppointmentsSnap.forEach((d) => remoteAppointments.set(d.id, stripServerFields<Appointment>(d.data())));

  const remoteVhv = new Map<string, VhvMember>();
  remoteVhvSnap.forEach((d) => remoteVhv.set(d.id, stripServerFields<VhvMember>(d.data())));

  const remoteTombstones = new Map<string, Tombstone>();
  remoteTombstonesSnap.forEach((d) => remoteTombstones.set(d.id, stripServerFields<Tombstone>(d.data())));

  let pushedCount = 0;
  let pulledCount = 0;
  let deletedCount = 0;
  const conflicts: SyncConflict[] = [];

  // Track pending local edits in sync_queue by collection:id
  const pendingEditKeys = new Set<string>();
  for (const q of syncQueue) {
    if (q?.payload?.id && q?.collection) {
      pendingEditKeys.add(`${q.collection}:${q.payload.id}`);
    }
  }

  // 1. Reconcile Tombstones (Deletions)
  const localTombKeys = new Set(localTombstones.map((t) => `${t.collection}__${t.id}`));
  for (const t of localTombstones) {
    const key = `${t.collection}__${t.id}`;
    if (!isValidFirestoreId(key) || !isValidFirestoreId(t.id)) continue;

    if (!remoteTombstones.has(key)) {
      // Delete remote entity if present and upload tombstone
      const targetRef = doc(db, 'users', user.uid, t.collection, t.id);
      await deleteDoc(targetRef).catch(() => undefined);
      await setDoc(doc(db, 'users', user.uid, 'tombstones', key), {
        id: t.id,
        collection: t.collection,
        villageNo: Math.max(0, Math.min(999, Math.round(Number(t.villageNo) || 0))),
        deletedAt: t.deletedAt || new Date().toISOString(),
        serverCreatedAt: serverTimestamp(),
        serverUpdatedAt: serverTimestamp(),
      });
      remoteTombstones.set(key, t);
      deletedCount++;
    }
  }

  for (const [key, rt] of remoteTombstones.entries()) {
    if (!localTombKeys.has(key)) {
      await storage.applyCloudDeletion(rt.collection, rt.id, rt.villageNo, rt.deletedAt);
      deletedCount++;
    }
  }

  const deletedSet = new Set(
    [...localTombstones.map((t) => `${t.collection}__${t.id}`), ...Array.from(remoteTombstones.keys())]
  );

  // 2. Sync VHV Members
  const localVhvMap = new Map(localVhv.map((m) => [m.id, m]));
  for (const m of localVhv) {
    if (!isValidFirestoreId(m.id) || deletedSet.has(`vhv_members__${m.id}`)) continue;
    const remote = remoteVhv.get(m.id);
    if (!remote) {
      await upsertDoc(user.uid, 'vhv_members', m.id, normalizeVhvForCloud(m), false);
      pushedCount++;
    } else if (JSON.stringify(normalizeVhvForCloud(m)) !== JSON.stringify(normalizeVhvForCloud(remote))) {
      if (pendingEditKeys.has(`vhv_members:${m.id}`)) {
        await upsertDoc(user.uid, 'vhv_members', m.id, normalizeVhvForCloud(m), true);
        pushedCount++;
      } else {
        await storage.upsertVhvFromCloud(remote);
        pulledCount++;
      }
    }
  }
  for (const [id, rm] of remoteVhv.entries()) {
    if (!localVhvMap.has(id) && !deletedSet.has(`vhv_members__${id}`)) {
      await storage.upsertVhvFromCloud(rm);
      pulledCount++;
    }
  }

  // 3. Sync Households
  const localHouseMap = new Map(localHouseholds.map((h) => [h.id, h]));
  for (const h of localHouseholds) {
    if (!isValidFirestoreId(h.id) || deletedSet.has(`households__${h.id}`)) continue;
    const remote = remoteHouseholds.get(h.id);
    if (!remote) {
      await upsertDoc(user.uid, 'households', h.id, normalizeHouseholdForCloud(h), false);
      pushedCount++;
    } else {
      const localNorm = normalizeHouseholdForCloud(h);
      const remoteNorm = normalizeHouseholdForCloud(remote);
      const changed = JSON.stringify({ ...localNorm, updatedAt: '' }) !== JSON.stringify({ ...remoteNorm, updatedAt: '' });
      if (changed) {
        const choice = resolveChoices[h.id];
        const hasPendingLocal = pendingEditKeys.has(`households:${h.id}`);
        const localMs = toTimestampMs(h.updatedAt);
        const remoteMs = toTimestampMs(remote.updatedAt);

        if (choice === 'local') {
          await upsertDoc(user.uid, 'households', h.id, localNorm, true);
          pushedCount++;
        } else if (choice === 'server') {
          await storage.upsertHouseholdFromCloud(remote);
          pulledCount++;
        } else if (hasPendingLocal && remoteMs > localMs) {
          conflicts.push({
            id: h.id,
            collection: 'households',
            title: `ข้อมูลหลังคาเรือน บ้านเลขที่ ${h.houseNo} หมู่ ${h.villageNo}`,
            localTime: formatTimeShort(h.updatedAt),
            serverTime: formatTimeShort(remote.updatedAt),
            diffFields: buildHouseholdDiff(h, remote),
            localRecord: h as unknown as Record<string, unknown>,
            serverRecord: remote as unknown as Record<string, unknown>,
          });
        } else if (hasPendingLocal || localMs > remoteMs) {
          await upsertDoc(user.uid, 'households', h.id, localNorm, true);
          pushedCount++;
        } else if (remoteMs > localMs) {
          await storage.upsertHouseholdFromCloud(remote);
          pulledCount++;
        }
      }
    }
  }
  for (const [id, rh] of remoteHouseholds.entries()) {
    if (!localHouseMap.has(id) && !deletedSet.has(`households__${id}`)) {
      await storage.upsertHouseholdFromCloud(rh);
      pulledCount++;
    }
  }

  // 4. Sync Persons
  const localPersonMap = new Map(localPersons.map((p) => [p.id, p]));
  for (const p of localPersons) {
    if (!isValidFirestoreId(p.id) || deletedSet.has(`persons__${p.id}`)) continue;
    const remote = remotePersons.get(p.id);
    if (!remote) {
      await upsertDoc(user.uid, 'persons', p.id, normalizePersonForCloud(p), false);
      pushedCount++;
    } else {
      const localNorm = normalizePersonForCloud(p);
      const remoteNorm = normalizePersonForCloud(remote);
      const changed = JSON.stringify({ ...localNorm, updatedAt: '' }) !== JSON.stringify({ ...remoteNorm, updatedAt: '' });
      if (changed) {
        const choice = resolveChoices[p.id];
        const hasPendingLocal = pendingEditKeys.has(`persons:${p.id}`);
        const localMs = toTimestampMs(p.updatedAt);
        const remoteMs = toTimestampMs(remote.updatedAt);

        if (choice === 'local') {
          await upsertDoc(user.uid, 'persons', p.id, localNorm, true);
          pushedCount++;
        } else if (choice === 'server') {
          await storage.upsertPersonFromCloud(remote);
          pulledCount++;
        } else if (hasPendingLocal && remoteMs > localMs) {
          conflicts.push({
            id: p.id,
            collection: 'persons',
            title: `ข้อมูลประชากร ${p.title}${p.firstName} ${p.lastName}`,
            localTime: formatTimeShort(p.updatedAt),
            serverTime: formatTimeShort(remote.updatedAt),
            diffFields: buildPersonDiff(p, remote),
            localRecord: p as unknown as Record<string, unknown>,
            serverRecord: remote as unknown as Record<string, unknown>,
          });
        } else if (hasPendingLocal || localMs > remoteMs) {
          await upsertDoc(user.uid, 'persons', p.id, localNorm, true);
          pushedCount++;
        } else if (remoteMs > localMs) {
          await storage.upsertPersonFromCloud(remote);
          pulledCount++;
        }
      }
    }
  }
  for (const [id, rp] of remotePersons.entries()) {
    if (!localPersonMap.has(id) && !deletedSet.has(`persons__${id}`)) {
      await storage.upsertPersonFromCloud(rp);
      pulledCount++;
    }
  }

  // 5. Sync Screenings (append-mostly)
  const localScreeningMap = new Map(localScreenings.map((s) => [s.id, s]));
  for (const s of localScreenings) {
    if (!isValidFirestoreId(s.id) || deletedSet.has(`screenings__${s.id}`)) continue;
    if (!remoteScreenings.has(s.id)) {
      await upsertDoc(user.uid, 'screenings', s.id, normalizeScreeningForCloud(s), false);
      pushedCount++;
    }
  }
  for (const [id, rs] of remoteScreenings.entries()) {
    if (!localScreeningMap.has(id) && !deletedSet.has(`screenings__${id}`)) {
      await storage.upsertScreeningFromCloud(rs);
      pulledCount++;
    }
  }

  // 6. Sync Appointments
  const localAptMap = new Map(localAppointments.map((a) => [a.id, a]));
  for (const a of localAppointments) {
    if (!isValidFirestoreId(a.id) || deletedSet.has(`appointments__${a.id}`)) continue;
    const remote = remoteAppointments.get(a.id);
    if (!remote) {
      await upsertDoc(user.uid, 'appointments', a.id, normalizeAppointmentForCloud(a), false);
      pushedCount++;
    } else {
      const localNorm = normalizeAppointmentForCloud(a);
      const remoteNorm = normalizeAppointmentForCloud(remote);
      const changed = JSON.stringify({ ...localNorm, updatedAt: '' }) !== JSON.stringify({ ...remoteNorm, updatedAt: '' });
      if (changed) {
        const remoteLocked = remote.status === 'completed' || remote.status === 'cancelled';
        const localMs = toTimestampMs(a.updatedAt);
        const remoteMs = toTimestampMs(remote.updatedAt);

        if (!remoteLocked && (pendingEditKeys.has(`appointments:${a.id}`) || localMs > remoteMs)) {
          await upsertDoc(user.uid, 'appointments', a.id, localNorm, true);
          pushedCount++;
        } else {
          await storage.upsertAppointmentFromCloud(remote);
          pulledCount++;
        }
      }
    }
  }
  for (const [id, ra] of remoteAppointments.entries()) {
    if (!localAptMap.has(id) && !deletedSet.has(`appointments__${id}`)) {
      await storage.upsertAppointmentFromCloud(ra);
      pulledCount++;
    }
  }

  // Clear queue items that didn't trigger unresolved conflicts
  if (conflicts.length === 0) {
    await storage.clearSyncQueue();
  }

  // Update lastSyncAt on user profile
  const userRef = doc(db, 'users', user.uid);
  await updateDoc(userRef, {
    lastSyncAt: serverTimestamp(),
    serverUpdatedAt: serverTimestamp(),
  }).catch(() => undefined);

  const syncedAt = new Date().toISOString();
  await storage.log(
    'sync',
    'firestore',
    `ซิงค์ Firebase Cloud สำเร็จ (ส่งขึ้น ${pushedCount}, ดึงลง ${pulledCount}, ลบ ${deletedCount}${conflicts.length > 0 ? `, ขัดแย้ง ${conflicts.length}` : ''})`,
    user.displayName || user.email || 'อสม.'
  );

  return {
    pushedCount,
    pulledCount,
    deletedCount,
    conflicts,
    syncedAt,
  };
}
