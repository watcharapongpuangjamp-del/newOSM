import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  onAuthStateChanged,
  type Auth,
  type User,
} from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getAI, getGenerativeModel, GoogleAIBackend, type AI } from 'firebase/ai';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { Capacitor } from '@capacitor/core';
import firebaseAppletConfig from '../../firebase-applet-config.json';

const firebaseConfig = {
  apiKey: firebaseAppletConfig.apiKey,
  authDomain: firebaseAppletConfig.authDomain,
  projectId: firebaseAppletConfig.projectId,
  storageBucket: firebaseAppletConfig.storageBucket,
  messagingSenderId: firebaseAppletConfig.messagingSenderId,
  appId: firebaseAppletConfig.appId,
};

let cachedApp: FirebaseApp | null = null;
let cachedAuth: Auth | null = null;
let cachedDb: Firestore | null = null;
let cachedAi: AI | null = null;
let appCheckInitialized = false;

export function getFirebaseApp(): FirebaseApp {
  if (!cachedApp) {
    cachedApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  }
  if (!appCheckInitialized && typeof window !== 'undefined' && firebaseAppletConfig.recaptchaSiteKey) {
    appCheckInitialized = true;
    try {
      initializeAppCheck(cachedApp, {
        provider: new ReCaptchaEnterpriseProvider(firebaseAppletConfig.recaptchaSiteKey),
        isTokenAutoRefreshEnabled: true,
      });
    } catch (err) {
      console.warn('App Check initialization skipped:', err);
    }
  }
  return cachedApp;
}

export function getFirebaseAuth(): Auth {
  if (!cachedAuth) {
    cachedAuth = getAuth(getFirebaseApp());
  }
  return cachedAuth;
}

export function getFirebaseDb(): Firestore {
  if (!cachedDb) {
    const databaseId = firebaseAppletConfig.firestoreDatabaseId;
    if (!databaseId) {
      throw new Error('Missing firestoreDatabaseId in firebase-applet-config.json');
    }
    cachedDb = getFirestore(getFirebaseApp(), databaseId);
  }
  return cachedDb;
}

export function getFirebaseAi(): AI {
  if (!cachedAi) {
    cachedAi = getAI(getFirebaseApp(), { backend: new GoogleAIBackend() });
  }
  return cachedAi;
}

export function getFirestoreDatabaseId(): string {
  return firebaseAppletConfig.firestoreDatabaseId;
}

export function getFirebaseProjectId(): string {
  return firebaseAppletConfig.projectId;
}

export async function signInWithGoogleAccount(): Promise<User | null> {
  const auth = getFirebaseAuth();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  try {
    const result = await signInWithPopup(auth, provider);
    return result.user;
  } catch (err: any) {
    const code = err?.code || '';
    const message = String(err?.message || '');

    if (
      Capacitor.isNativePlatform() &&
      (code === 'auth/operation-not-supported-in-this-environment' ||
        code === 'auth/popup-blocked' ||
        message.includes('disallowed_useragent'))
    ) {
      throw new Error(
        'WebView ในแอป Android ไม่รองรับ Google Sign-In แบบ Popup โดยตรง (นโยบายความปลอดภัยของ Google) — คุณยังสามารถใช้งาน SQLite ออฟไลน์, ส่งออกไฟล์, และใช้ AI ผู้ช่วยได้เต็มรูปแบบ หรือเปิดเวอร์ชันเว็บ PWA เพื่อซิงค์ Cloud Firestore'
      );
    }

    if (code === 'auth/popup-blocked') {
      await signInWithRedirect(auth, provider);
      return null;
    }
    throw err;
  }
}

export async function signOutFirebase(): Promise<void> {
  const auth = getFirebaseAuth();
  await signOut(auth);
}

export function subscribeAuthState(callback: (user: User | null) => void): () => void {
  const auth = getFirebaseAuth();
  return onAuthStateChanged(auth, callback);
}

const VHV_SYSTEM_INSTRUCTION = `คุณคือ "Smart Health AI" ผู้ช่วยอัจฉริยะสำหรับอาสาสมัครสาธารณสุขประจำหมู่บ้าน (อสม.) ของประเทศไทย
หน้าที่ของคุณคือให้คำแนะนำด้านสาธารณสุขมูลฐาน การคัดกรองโรคไม่ติดต่อเรื้อรัง (เบาหวาน ความดันโลหิตสูง BMI) การดูแลผู้ป่วย 3 ติด (ติดสังคม ติดบ้าน ติดเตียง) มาตรการ 3 เก็บ ป้องกัน 3 โรค (ไข้เลือดออก ซิกา ชิคุนกุนยา) และเกณฑ์การส่งต่อผู้ป่วยไปยัง รพ.สต. หรือโรงพยาบาล ตามแนวทางกระทรวงสาธารณสุขประเทศไทย

หลักเกณฑ์การตอบ:
1. ตอบเป็นภาษาไทยที่สุภาพ กระชับ อ่านง่าย เป็นขั้นตอน (ใช้หัวข้อย่อยชัดเจน) เพื่อให้ อสม. นำไปปฏิบัติหน้างานได้ทันที
2. ระบุเกณฑ์ตัวเลขที่ชัดเจนเมื่อเกี่ยวข้อง (เช่น ความดันโลหิต ≥ 140/90 mmHg, วิกฤต ≥ 180/120 mmHg, น้ำตาลปลายนิ้ว DTX อดอาหาร ≥ 126 mg/dL)
3. เน้นเตือนสัญญาณอันตราย (Red Flags) ที่ต้องรีบส่งต่อแพทย์หรือโทรสายด่วนฉุกเฉิน 1669 ทันที
4. ห้ามวินิจฉัยโรคแทนแพทย์หรือสั่งจ่ายยาอันตราย ให้แนะนำเป็นการคัดกรอง การดูแลเบื้องต้น และการประสานเจ้าหน้าที่ รพ.สต.`;

export async function streamHealthAssistantAI(
  question: string,
  communityContext?: string,
  onChunk?: (accumulatedText: string) => void
): Promise<string> {
  const ai = getFirebaseAi();
  const model = getGenerativeModel(ai, {
    model: 'gemini-3.8-flash',
    systemInstruction: VHV_SYSTEM_INSTRUCTION,
  });

  const prompt = communityContext
    ? `บริบทข้อมูลชุมชนปัจจุบัน (ภาพรวมโดยสังเขป ไม่ระบุตัวตน): ${communityContext}\n\nคำถามจาก อสม.: ${question}`
    : `คำถามจาก อสม.: ${question}`;

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 45000);

  try {
    const streamResult = await model.generateContentStream(prompt, {
      signal: controller.signal,
    });

    let accumulated = '';
    for await (const chunk of streamResult.stream) {
      const text = chunk.text();
      if (text) {
        accumulated += text;
        onChunk?.(accumulated);
      }
    }

    if (!accumulated.trim()) {
      const finalResponse = await streamResult.response;
      accumulated = finalResponse.text();
      if (accumulated) onChunk?.(accumulated);
    }

    if (!accumulated.trim()) {
      throw new Error('AI ไม่ส่งคำตอบกลับมา กรุณาลองใหม่อีกครั้ง');
    }

    return accumulated;
  } finally {
    window.clearTimeout(timeoutId);
  }
}
