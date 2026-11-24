import type { Religion } from "@/generated/types.gen";

/* One list, so the recording form's picker and a unit's thread say it alike. */
export const RELIGION_LABEL: Record<Religion, string> = {
  buddhist: "Buddhist",
  christian: "Christian",
  hindu: "Hindu",
  freethinker: "Freethinker",
  others: "Others",
};

export const RELIGIONS = (Object.keys(RELIGION_LABEL) as Religion[]).map((value) => ({
  value,
  label: RELIGION_LABEL[value],
}));
