import type { Language } from "~/utils/languages";

export const Flag = ({
  language,
  width = 84,
}: {
  language: Language;
  width?: number;
}) => {
  const height = width * (19.3171 / 24);
  return (
    <svg viewBox={language.viewBox} style={{ height, width }}>
      <image
        height={3168}
        href="/flags.svg"
        width={82}
      ></image>
    </svg>
  );
};
