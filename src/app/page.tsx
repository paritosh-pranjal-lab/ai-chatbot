import Chat from "@/components/Chat/Chat";

import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Chat />
      </div>
    </main>
  );
}
