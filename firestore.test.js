import { createRequire } from "node:module";
import { test, before, after, beforeEach } from "node:test";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const rutPath = require.resolve("@firebase/rules-unit-testing");
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require(rutPath);

const rutRequire = createRequire(rutPath);
const firebaseMod = rutRequire("firebase/compat/app");
const firebase = firebaseMod.default || firebaseMod;
rutRequire("firebase/compat/firestore");

const serverTimestamp = () => firebase.firestore.FieldValue.serverTimestamp();

let testEnv;
const PROJECT_ID = process.env.GCP_PROJECT || "demo-no-project";
const ALICE_UID = "alice_123";
const BOB_UID = "bob_456";

const [emulatorHost, emulatorPortStr] = (
  process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8085"
).split(":");
const emulatorPort = parseInt(emulatorPortStr, 10);

function sampleHousehold(id = "house-1") {
  return {
    id,
    houseNo: "12/1",
    villageNo: 1,
    villageName: "หมู่ 1 บ้านสุขใจ",
    subdistrict: "ตำบลสุขภาพดี",
    district: "อำเภอเมือง",
    province: "เชียงใหม่",
    latitude: 18.7883,
    longitude: 98.9853,
    headOfHouseholdName: "นายสมชาย ใจดี",
    vhvMemberId: "vhv-1",
    sanitationRating: "good",
    mosquitoLarvaFound: false,
    waterSource: "ประปาหมู่บ้าน",
    wasteManagement: "คัดแยกขยะ",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    serverCreatedAt: serverTimestamp(),
    serverUpdatedAt: serverTimestamp(),
  };
}

function samplePerson(id = "person-1", householdId = "house-1") {
  return {
    id,
    householdId,
    villageNo: 1,
    citizenId: "1100501234567",
    title: "นาย",
    firstName: "สมชาย",
    lastName: "ใจดี",
    gender: "male",
    birthDate: "1960-05-10",
    bloodGroup: "O",
    residentStatus: "resident",
    careCategory: "active",
    chronicDiseases: ["ความดันโลหิตสูง"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    serverCreatedAt: serverTimestamp(),
    serverUpdatedAt: serverTimestamp(),
  };
}

function sampleAppointment(id = "apt-1", status = "upcoming") {
  return {
    id,
    personId: "person-1",
    householdId: "house-1",
    villageNo: 1,
    vhvMemberId: "vhv-1",
    title: "เยี่ยมบ้านตรวจวัดความดัน",
    type: "home_visit",
    date: "2026-02-01",
    location: "บ้าน 12/1",
    status,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    serverCreatedAt: serverTimestamp(),
    serverUpdatedAt: serverTimestamp(),
  };
}

before(async () => {
  const rules = fs.readFileSync("./firestore.rules", "utf8");
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules,
      host: emulatorHost,
      port: emulatorPort,
    },
  });
});

after(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

beforeEach(async () => {
  if (testEnv) {
    await testEnv.clearFirestore();
  }
});

// --- NEGATIVE SECURITY TESTS ---

test("Unauthenticated user: cannot read or write households", async () => {
  const unauthDb = testEnv.unauthenticatedContext().firestore();
  await assertFails(
    unauthDb.collection("users").doc(ALICE_UID).collection("households").get()
  );
  await assertFails(
    unauthDb
      .collection("users")
      .doc(ALICE_UID)
      .collection("households")
      .doc("house-1")
      .set(sampleHousehold())
  );
});

test("Cross-user isolation: Bob cannot read or write Alice's households, persons, or profile", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.collection("users").doc(ALICE_UID).set({
      uid: ALICE_UID,
      displayName: "Alice VHV",
      email: "alice@example.com",
      serverCreatedAt: serverTimestamp(),
      serverUpdatedAt: serverTimestamp(),
    });
    await db
      .collection("users")
      .doc(ALICE_UID)
      .collection("households")
      .doc("house-1")
      .set(sampleHousehold("house-1"));
  });

  const bobDb = testEnv.authenticatedContext(BOB_UID).firestore();
  await assertFails(bobDb.collection("users").doc(ALICE_UID).get());
  await assertFails(
    bobDb
      .collection("users")
      .doc(ALICE_UID)
      .collection("households")
      .doc("house-1")
      .get()
  );
  await assertFails(
    bobDb.collection("users").doc(ALICE_UID).collection("households").get()
  );
  await assertFails(
    bobDb
      .collection("users")
      .doc(ALICE_UID)
      .collection("households")
      .doc("house-2")
      .set(sampleHousehold("house-2"))
  );
});

test("Shadow update & ghost field injection: rejects unknown fields on household create and update", async () => {
  const aliceDb = testEnv.authenticatedContext(ALICE_UID).firestore();
  const houseRef = aliceDb
    .collection("users")
    .doc(ALICE_UID)
    .collection("households")
    .doc("house-1");

  // Ghost field on create
  await assertFails(
    houseRef.set({
      ...sampleHousehold("house-1"),
      isAdmin: true,
    })
  );

  // Valid create
  await assertSucceeds(houseRef.set(sampleHousehold("house-1")));

  // Ghost field on update
  await assertFails(
    houseRef.update({
      sanitationRating: "fair",
      isVerified: true,
      updatedAt: "2026-01-02T00:00:00.000Z",
      serverUpdatedAt: serverTimestamp(),
    })
  );
});

test("Client clock timestamp spoofing & immutable createdAt overwrite are rejected", async () => {
  const aliceDb = testEnv.authenticatedContext(ALICE_UID).firestore();
  const houseRef = aliceDb
    .collection("users")
    .doc(ALICE_UID)
    .collection("households")
    .doc("house-1");

  // Future timestamp spoofing rejected
  const futureDate = new Date(Date.now() + 3600 * 1000);
  await assertFails(
    houseRef.set({
      ...sampleHousehold("house-1"),
      serverCreatedAt: futureDate,
    })
  );

  // Valid create
  await assertSucceeds(houseRef.set(sampleHousehold("house-1")));

  // Overwriting immutable createdAt rejected
  await assertFails(
    houseRef.update({
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      serverUpdatedAt: serverTimestamp(),
    })
  );
});

test("Terminal state locking: completed appointment cannot be mutated afterwards", async () => {
  const aliceDb = testEnv.authenticatedContext(ALICE_UID).firestore();
  const aptRef = aliceDb
    .collection("users")
    .doc(ALICE_UID)
    .collection("appointments")
    .doc("apt-1");

  await assertSucceeds(aptRef.set(sampleAppointment("apt-1", "upcoming")));
  await assertSucceeds(
    aptRef.update({
      status: "completed",
      updatedAt: "2026-01-02T00:00:00.000Z",
      serverUpdatedAt: serverTimestamp(),
    })
  );

  // Attempting to reopen completed appointment must fail
  await assertFails(
    aptRef.update({
      status: "upcoming",
      updatedAt: "2026-01-03T00:00:00.000Z",
      serverUpdatedAt: serverTimestamp(),
    })
  );
});

// --- POSITIVE CRUD & LIST QUERY TESTS ---

test("Authenticated owner: can create, list, update, and delete own records cleanly", async () => {
  const aliceDb = testEnv.authenticatedContext(ALICE_UID).firestore();
  const userDoc = aliceDb.collection("users").doc(ALICE_UID);

  await assertSucceeds(
    userDoc.set({
      uid: ALICE_UID,
      displayName: "อสม. อลิซ",
      email: "alice@example.com",
      serverCreatedAt: serverTimestamp(),
      serverUpdatedAt: serverTimestamp(),
    })
  );

  const houseRef = userDoc.collection("households").doc("house-1");
  await assertSucceeds(houseRef.set(sampleHousehold("house-1")));
  await assertSucceeds(userDoc.collection("households").get());

  await assertSucceeds(
    houseRef.update({
      mosquitoLarvaFound: true,
      notes: "พบลูกน้ำบริเวณอ่างบัว",
      updatedAt: "2026-01-02T00:00:00.000Z",
      serverUpdatedAt: serverTimestamp(),
    })
  );

  const personRef = userDoc.collection("persons").doc("person-1");
  await assertSucceeds(personRef.set(samplePerson("person-1", "house-1")));
  await assertSucceeds(userDoc.collection("persons").get());

  const tombstoneRef = userDoc.collection("tombstones").doc("households__house-1");
  await assertSucceeds(
    tombstoneRef.set({
      id: "house-1",
      collection: "households",
      villageNo: 1,
      deletedAt: "2026-01-03T00:00:00.000Z",
      serverCreatedAt: serverTimestamp(),
      serverUpdatedAt: serverTimestamp(),
    })
  );

  await assertSucceeds(houseRef.delete());
});
