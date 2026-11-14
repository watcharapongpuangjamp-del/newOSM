import { Household, Person } from '../types';
import { validateThaiCitizenId } from './thaiId';

export type QrScanResolution =
  | {
      status: 'matched_household';
      household: Household;
      rawText: string;
      matchedBy: string;
    }
  | {
      status: 'matched_person';
      person: Person;
      household?: Household;
      rawText: string;
      matchedBy: string;
    }
  | {
      status: 'not_found';
      rawText: string;
      extractedCitizenId?: string;
    };

/**
 * Build canonical QR payload string for a Household.
 */
export function buildHouseholdQrPayload(household: Household): string {
  return `smartosm://household/${household.id}`;
}

/**
 * Build canonical QR payload string for a Person.
 */
export function buildPersonQrPayload(person: Person): string {
  return `smartosm://person/${person.id}`;
}

/**
 * Resolve a scanned QR code (or manually entered ID) against local households & persons.
 * Supports:
 * - smartosm://household/<id> or SMARTOSM:HOUSEHOLD:<id>
 * - smartosm://person/<id> or SMARTOSM:PERSON:<id>
 * - JSON payloads: {"type":"household","id":"..."} / {"type":"person","id":"...","citizenId":"..."}
 * - Raw household.id / person.id
 * - 13-digit Thai Citizen ID (with or without dashes, or embedded in card text)
 * - Unambiguous houseNo match
 */
export function resolveQrScanResult(
  rawInput: string,
  households: Household[],
  persons: Person[]
): QrScanResolution {
  const rawText = rawInput.trim();
  if (!rawText) {
    return { status: 'not_found', rawText };
  }

  // 1. Canonical URI / Prefixed formats
  const householdUriMatch = rawText.match(/^(?:smartosm:\/\/household\/|SMARTOSM:HOUSEHOLD:)(.+)$/i);
  if (householdUriMatch) {
    const targetId = householdUriMatch[1].trim();
    const household = households.find((h) => h.id === targetId);
    if (household) {
      return {
        status: 'matched_household',
        household,
        rawText,
        matchedBy: 'รหัสครัวเรือน (Household QR)',
      };
    }
  }

  const personUriMatch = rawText.match(/^(?:smartosm:\/\/person\/|SMARTOSM:PERSON:)(.+)$/i);
  if (personUriMatch) {
    const targetId = personUriMatch[1].trim();
    const cleanDigits = targetId.replace(/\D/g, '');
    const person = persons.find(
      (p) =>
        p.id === targetId ||
        (cleanDigits.length === 13 && p.citizenId.replace(/\D/g, '') === cleanDigits)
    );
    if (person) {
      return {
        status: 'matched_person',
        person,
        household: households.find((h) => h.id === person.householdId),
        rawText,
        matchedBy: 'รหัสประชากร (Person QR)',
      };
    }
  }

  // 2. JSON payload
  if (rawText.startsWith('{') && rawText.endsWith('}')) {
    try {
      const parsed = JSON.parse(rawText) as Record<string, unknown>;
      const type = typeof parsed.type === 'string' ? parsed.type.toLowerCase() : '';
      const id = typeof parsed.id === 'string' ? parsed.id.trim() : '';
      const citizenId =
        typeof parsed.citizenId === 'string' ? parsed.citizenId.replace(/\D/g, '') : '';
      const houseNo = typeof parsed.houseNo === 'string' ? parsed.houseNo.trim() : '';
      const villageNo = typeof parsed.villageNo === 'number' ? parsed.villageNo : undefined;

      if (type === 'household' || (!type && id && households.some((h) => h.id === id))) {
        const household = households.find(
          (h) =>
            (id && h.id === id) ||
            (houseNo && h.houseNo === houseNo && (villageNo === undefined || h.villageNo === villageNo))
        );
        if (household) {
          return {
            status: 'matched_household',
            household,
            rawText,
            matchedBy: 'ข้อมูล QR ครัวเรือน (JSON)',
          };
        }
      }

      if (type === 'person' || id || citizenId) {
        const person = persons.find(
          (p) =>
            (id && p.id === id) ||
            (citizenId.length === 13 && p.citizenId.replace(/\D/g, '') === citizenId)
        );
        if (person) {
          return {
            status: 'matched_person',
            person,
            household: households.find((h) => h.id === person.householdId),
            rawText,
            matchedBy: 'ข้อมูล QR ประชากร (JSON)',
          };
        }
      }
    } catch {
      // Fall through to raw matching
    }
  }

  // 3. Direct ID match (household.id or person.id)
  const directHousehold = households.find((h) => h.id.toLowerCase() === rawText.toLowerCase());
  if (directHousehold) {
    return {
      status: 'matched_household',
      household: directHousehold,
      rawText,
      matchedBy: 'รหัสครัวเรือนในระบบ',
    };
  }

  const directPerson = persons.find((p) => p.id.toLowerCase() === rawText.toLowerCase());
  if (directPerson) {
    return {
      status: 'matched_person',
      person: directPerson,
      household: households.find((h) => h.id === directPerson.householdId),
      rawText,
      matchedBy: 'รหัสประชากรในระบบ',
    };
  }

  // 4. Thai 13-digit Citizen ID (exact or embedded in text)
  const digitsOnly = rawText.replace(/\D/g, '');
  if (digitsOnly.length === 13) {
    const personByCid = persons.find((p) => p.citizenId.replace(/\D/g, '') === digitsOnly);
    if (personByCid) {
      return {
        status: 'matched_person',
        person: personByCid,
        household: households.find((h) => h.id === personByCid.householdId),
        rawText,
        matchedBy: 'เลขประจำตัวประชาชน 13 หลัก',
      };
    }
    const validation = validateThaiCitizenId(digitsOnly);
    return {
      status: 'not_found',
      rawText,
      extractedCitizenId: validation.isValid ? digitsOnly : undefined,
    };
  }

  const embedded13Match = rawText.match(/\b(\d{13})\b/);
  if (embedded13Match) {
    const cid = embedded13Match[1];
    const personByCid = persons.find((p) => p.citizenId.replace(/\D/g, '') === cid);
    if (personByCid) {
      return {
        status: 'matched_person',
        person: personByCid,
        household: households.find((h) => h.id === personByCid.householdId),
        rawText,
        matchedBy: 'เลขประจำตัวประชาชน 13 หลัก',
      };
    }
    const validation = validateThaiCitizenId(cid);
    return {
      status: 'not_found',
      rawText,
      extractedCitizenId: validation.isValid ? cid : undefined,
    };
  }

  // 5. Unambiguous houseNo match (useful for manual entry fallback)
  const houseNoMatches = households.filter(
    (h) => h.houseNo.toLowerCase() === rawText.toLowerCase()
  );
  if (houseNoMatches.length === 1) {
    return {
      status: 'matched_household',
      household: houseNoMatches[0],
      rawText,
      matchedBy: 'บ้านเลขที่',
    };
  }

  return { status: 'not_found', rawText };
}
