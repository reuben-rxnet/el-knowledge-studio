// Studio's brand template: how intro and outro cards, the lower third and captions look. A brand
// administrator sets it once in Brand Center; every Studio edit then only chooses whether the intro,
// outro and lower third appear. Shared by the browser (previews) and the server (renders).
import { z } from "zod";

export const BRAND_ACCENTS = { cyan: "#00A6CE", blue: "#1565C0", teal: "#00A99D", gold: "#D6A84B" } as const;
export type BrandAccent = keyof typeof BRAND_ACCENTS;
export const CAPTION_SIZES = { small: 0.8, medium: 1, large: 1.25 } as const;

export interface BrandTemplate {
  accent: BrandAccent;
  /** Seconds the intro and outro cards are shown. */
  introSec: number;
  outroSec: number;
  /** Small line above the title on the intro card, e.g. the team or programme name. */
  introKicker: string;
  /** Text on the outro card. */
  outroText: string;
  /** Show the EssilorLuxottica wordmark (approved asset) on the cards. */
  showLogo: boolean;
  /** Seconds the lower third (title and subtitle, bottom left) stays at the start of the video. */
  lowerThirdSec: number;
  captionSize: keyof typeof CAPTION_SIZES;
  /** white: white on a dark box; yellow: yellow on a dark box (easier to tell apart from screen text). */
  captionColor: "white" | "yellow";
}

export const DEFAULT_BRAND_TEMPLATE: BrandTemplate = {
  accent: "cyan", introSec: 3, outroSec: 4, introKicker: "EL Knowledge Studio",
  outroText: "Find more how-to guides in EL Knowledge Studio", showLogo: true, lowerThirdSec: 5,
  captionSize: "medium", captionColor: "white",
};

export const brandTemplateSchema = z.object({
  accent: z.enum(Object.keys(BRAND_ACCENTS) as [BrandAccent, ...BrandAccent[]]),
  introSec: z.number().min(1.5).max(8),
  outroSec: z.number().min(1.5).max(10),
  introKicker: z.string().trim().max(60),
  outroText: z.string().trim().max(120),
  showLogo: z.boolean(),
  lowerThirdSec: z.number().min(2).max(12),
  captionSize: z.enum(["small", "medium", "large"]),
  captionColor: z.enum(["white", "yellow"]),
});

/** Stored values over the defaults; anything invalid falls back to the default. */
export function normaliseBrandTemplate(stored: unknown): BrandTemplate {
  const merged = { ...DEFAULT_BRAND_TEMPLATE, ...(stored && typeof stored === "object" ? stored : {}) };
  const parsed = brandTemplateSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_BRAND_TEMPLATE;
}
