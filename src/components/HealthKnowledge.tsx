import React, { useState } from 'react';
import {
  BookOpen,
  Sparkles,
  PhoneCall,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Send,
  Loader2,
} from 'lucide-react';
import { streamHealthAssistantAI } from '../services/firebase';

interface HealthKnowledgeProps {
  communitySummary?: string;
}

const QUICK_PROMPTS = [
  'ความดันโลหิต 155/95 mmHg ควรแนะนำและส่งต่ออย่างไร?',
  'เกณฑ์ค่าน้ำตาลปลายนิ้ว (DTX) สำหรับคัดกรองเบาหวานเป็นอย่างไร?',
  'วิธีใส่ทรายอะเบทและมาตรการ 3 เก็บ ป้องกันไข้เลือดออก',
  'การพลิกตัวและป้องกันแผลกดทับในผู้ป่วยติดเตียง',
];

export const HealthKnowledge: React.FC<HealthKnowledgeProps> = ({ communitySummary }) => {
  const [openSection, setOpenSection] = useState<number | null>(0);
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);

  const GUIDELINES = [
    {
      title: '1. เกณฑ์การประเมินภาวะพึ่งพิง 3 ติด (ตามดัชนี Barthel ADL)',
      content: `
• ติดสังคม (Active): ผู้สูงอายุหรือผู้ป่วยที่มีคะแนน ADL 12 - 20 คะแนน สามารถปฏิบัติกิจวัตรประจำวันได้ด้วยตนเองอย่างคล่องแคล่ว ช่วยเหลือชุมชนและเข้าร่วมกิจกรรมทางสังคมได้ดี
• ติดบ้าน (Homebound): มีคะแนน ADL 5 - 11 คะแนน ปฏิบัติกิจวัตรประจำวันได้บางส่วน ต้องการการช่วยเหลือในบางเรื่อง เช่น การอาบน้ำ การแต่งตัว หรือการเดินขึ้นบันได สามารถเดินรอบบ้านได้
• ติดเตียง (Bedridden): มีคะแนน ADL 0 - 4 คะแนน ป่วยหนักหรือเคลื่อนไหวไม่ได้ ต้องนอนบนเตียงเป็นส่วนใหญ่ ช่วยเหลือตนเองไม่ได้ จำเป็นต้องมีผู้ดูแลใกล้ชิด เสี่ยงต่อแผลกดทับและข้อติด
      `,
    },
    {
      title: '2. การประเมินความดันโลหิตและการส่งต่อผู้ป่วย',
      content: `
• ปกติ: ความดันตัวบน < 120 และตัวล่าง < 80 mmHg
• เริ่มสูง (Pre-hypertension): 120 - 129 / < 80 mmHg (แนะนำปรับพฤติกรรม ลดเค็ม ออกกำลังกาย)
• ความดันสูง ระดับ 1: 130 - 139 หรือ 80 - 89 mmHg (ตรวจซ้ำใน 2 สัปดาห์)
• ความดันสูง ระดับ 2: ≥ 140 หรือ ≥ 90 mmHg (นัดพบแพทย์ รพ.สต. เพื่อรับยาลดความดัน)
• ภาวะวิกฤต (Crisis): ≥ 180 หรือ ≥ 120 mmHg พร้อมมีอาการปวดศีรษะ ตาพร่ามัว เจ็บหน้าอก (ส่งโรงพยาบาลด่วนทันที!)
      `,
    },
    {
      title: '3. มาตรการ 3 เก็บ ป้องกัน 3 โรค (ไข้เลือดออก, ซิกา, ชิคุนกุนยา)',
      content: `
1. เก็บบ้าน ให้สะอาด ปลอดโปร่ง ไม่ให้มีมุมอับทึบเป็นที่เกาะพักของยุงลาย
2. เก็บขยะ เศษภาชนะรอบบ้าน เช่น ยางรถยนต์เก่า กะลามะพร้าว กระป๋อง ไม่ให้เป็นแหล่งเพาะพันธุ์
3. เก็บน้ำ ภาชนะใส่น้ำต้องปิดฝาให้มิดชิด หรือใส่ทรายอะเบท (1 กรัม ต่อน้ำ 10 ลิตร) หรือปล่อยปลากินลูกน้ำ
• ค่าดัชนีลูกน้ำยุงลายในบ้าน (House Index: HI) ควรน้อยกว่า 5%
      `,
    },
    {
      title: '4. การดูแลผู้ป่วยติดเตียงและป้องกันแผลกดทับ',
      content: `
• พลิกตัวเปลี่ยนท่าทุก 2 ชั่วโมง เป็นประจำทั้งกลางวันและกลางคืน เพื่อกระจายแรงกดทับ
• ใช้ที่นอนลม (Air Mattress) หรือหมอนนุ่มรองบริเวณปุ่มกระดูก เช่น ส้นเท้า สะโพก ก้นกบ
• รักษาความสะอาดผิวหนังให้แห้งสะอาด ไม่อับชื้น ทาโลชั่นให้ความชุ่มชื้น
• ดูแลโภชนาการให้ได้รับโปรตีนเพียงพอ เช่น ไข่ขาวต้ม นม เพื่อช่วยซ่อมแซมเนื้อเยื่อ
      `,
    },
  ];

  const runAiQuery = async (questionText: string) => {
    const trimmed = questionText.trim();
    if (!trimmed || isAiLoading) return;

    setIsAiLoading(true);
    setAiAnswer('');
    setAiError(null);

    try {
      const fullText = await streamHealthAssistantAI(
        trimmed,
        communitySummary,
        (partial) => {
          setAiAnswer(partial);
        }
      );
      setAiAnswer(fullText);
    } catch (err: any) {
      console.error('Firebase AI Logic request failed:', err);
      const message =
        err?.name === 'AbortError'
          ? 'คำขอใช้เวลานานเกินไป (เกิน 45 วินาที) กรุณาลองใหม่อีกครั้ง'
          : err?.message || 'ไม่สามารถเชื่อมต่อ Firebase AI Logic ได้ กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต';
      setAiError(message);
      setAiAnswer((prev) => (prev && prev.trim().length > 0 ? prev : null));
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleAskAI = (e: React.FormEvent) => {
    e.preventDefault();
    void runAiQuery(aiQuestion);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-800 flex items-center gap-2">
          <BookOpen className="w-6 h-6 text-emerald-600" />
          <span>คลังความรู้สุขภาพชุมชน & AI ผู้ช่วย อสม.</span>
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
          แนวทางการปฏิบัติงานตามมาตรฐานกระทรวงสาธารณสุข และระบบตอบคำถามสุขภาพด้วย Gemini (Firebase AI Logic)
        </p>
      </div>

      {/* Emergency Hotline Banner */}
      <div className="bg-rose-50 border border-rose-100 rounded-xl p-4 sm:p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-rose-600 text-white rounded-xl">
            <PhoneCall className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-rose-900">
              สายด่วนการแพทย์ฉุกเฉิน 1669 (ฟรี 24 ชั่วโมง)
            </h3>
            <p className="text-xs text-rose-700 mt-0.5">
              หมดสติ ชักเกร็ง แน่นหน้าอก หายใจไม่ออก แขนขาอ่อนแรงเฉียบพลัน โทร 1669 ทันที
            </p>
          </div>
        </div>
        <div className="text-xs font-semibold text-rose-800 px-3 py-1.5 bg-rose-100 rounded-lg self-start sm:self-auto">
          เบอร์ รพ.สต. ประจำตำบล: 053-123-456
        </div>
      </div>

      {/* AI Smart Health Assistant (Firebase AI Logic - Gemini) */}
      <div className="bg-gradient-to-br from-emerald-900 via-teal-900 to-slate-900 text-white rounded-xl p-6 border border-emerald-800 shadow-md space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-emerald-500 text-white">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold">AI ผู้ช่วย อสม. อัจฉริยะ (Smart Health AI)</h2>
              <p className="text-xs text-emerald-200">
                ขับเคลื่อนด้วย Gemini ผ่าน Firebase AI Logic • สอบถามเกณฑ์คัดกรองและแนวทางดูแลผู้ป่วย
              </p>
            </div>
          </div>
          <span className="text-[11px] font-mono bg-emerald-800/80 border border-emerald-600/50 text-emerald-200 px-2.5 py-1 rounded-full">
            gemini-3.8-flash
          </span>
        </div>

        {/* Quick Prompts */}
        <div className="flex flex-wrap gap-1.5">
          {QUICK_PROMPTS.map((q) => (
            <button
              key={q}
              type="button"
              disabled={isAiLoading}
              onClick={() => {
                setAiQuestion(q);
                void runAiQuery(q);
              }}
              className="text-[11px] bg-white/10 hover:bg-white/20 text-emerald-100 px-2.5 py-1 rounded-lg border border-white/15 transition-colors disabled:opacity-50 text-left"
            >
              {q}
            </button>
          ))}
        </div>

        <form onSubmit={handleAskAI} className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            data-testid="ai_question_input"
            placeholder="พิมพ์คำถาม เช่น ค่าน้ำตาลเกิน 140 ต้องทำอย่างไร?, การดูแลผู้ป่วยติดเตียง..."
            value={aiQuestion}
            onChange={(e) => setAiQuestion(e.target.value)}
            className="flex-1 px-4 py-2.5 bg-white/10 border border-white/20 rounded-xl text-white placeholder-emerald-200/60 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
          />
          <button
            type="submit"
            data-testid="ai_ask_button"
            disabled={isAiLoading || !aiQuestion.trim()}
            className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-bold text-sm rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shrink-0"
          >
            {isAiLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>กำลังวิเคราะห์...</span>
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                <span>ถาม AI</span>
              </>
            )}
          </button>
        </form>

        {aiError && (
          <div
            role="alert"
            className="p-4 bg-rose-950/70 rounded-xl border border-rose-500/50 text-xs sm:text-sm text-rose-100 flex items-start gap-2.5"
          >
            <AlertTriangle className="w-4 h-4 text-rose-300 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-rose-200 block">เกิดข้อผิดพลาดในการเรียกใช้ AI</span>
              <span className="text-xs text-rose-100/90">{aiError}</span>
            </div>
          </div>
        )}

        {aiAnswer !== null && (aiAnswer.length > 0 || isAiLoading) && (
          <div className="p-4 bg-white/10 rounded-xl border border-white/20 text-xs sm:text-sm text-emerald-50 space-y-2 animate-in fade-in">
            <div className="flex items-center justify-between">
              <span className="font-bold text-emerald-300">คำแนะนำสำหรับ อสม.:</span>
              {isAiLoading && (
                <span className="text-[11px] text-emerald-200 animate-pulse">กำลังพิมพ์คำตอบ...</span>
              )}
            </div>
            <div className="leading-relaxed whitespace-pre-wrap">{aiAnswer}</div>
          </div>
        )}
      </div>

      {/* Standard Guidelines Accordions */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100 overflow-hidden">
        {GUIDELINES.map((item, idx) => {
          const isOpen = openSection === idx;
          return (
            <div key={idx} className="p-4 sm:p-5">
              <button
                onClick={() => setOpenSection(isOpen ? null : idx)}
                className="w-full flex items-center justify-between text-left font-bold text-sm sm:text-base text-slate-800 hover:text-emerald-700 transition-colors"
              >
                <span>{item.title}</span>
                {isOpen ? (
                  <ChevronUp className="w-5 h-5 text-slate-400" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-slate-400" />
                )}
              </button>

              {isOpen && (
                <div className="mt-3 pt-3 border-t border-slate-100 text-xs sm:text-sm text-slate-600 leading-relaxed whitespace-pre-line bg-slate-50 p-4 rounded-xl">
                  {item.content}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
