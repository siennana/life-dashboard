import { eq } from "drizzle-orm";
import { settings, type Db } from "@life/db";
import { uiSettingsSchema, type UiSettings } from "@life/shared";

// UI preferences (font, theme) live in the `settings` key/value table under
// one jsonb row, key "ui". Reads fall back to schema defaults when the row is
// missing or holds stale/unknown values, so old rows can never break the app.
const UI_KEY = "ui";

export async function getUiSettings(db: Db): Promise<UiSettings> {
  const rows = await db.select().from(settings).where(eq(settings.key, UI_KEY)).limit(1);
  const parsed = uiSettingsSchema.safeParse(rows[0]?.value ?? {});
  return parsed.success ? parsed.data : uiSettingsSchema.parse({});
}

export async function saveUiSettings(db: Db, value: UiSettings): Promise<UiSettings> {
  await db
    .insert(settings)
    .values({ key: UI_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
  return value;
}
