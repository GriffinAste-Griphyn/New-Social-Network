import Image from "next/image";
import styles from "./non-trad-venture-link.module.css";

export function NonTradVentureLink() {
  return (
    <a
      className={styles.link}
      href="https://nontrad.ventures"
      rel="noopener noreferrer"
      target="_blank"
    >
      <span className={styles.label}>
        <span className={styles.muted}>A Non-Tr</span>
        <span className={styles.emphasis}>ad Venture</span>
      </span>
      <Image
        alt=""
        aria-hidden="true"
        className={styles.cat}
        height={62}
        src="/non-trad-cat-exact.png"
        width={67}
      />
    </a>
  );
}
