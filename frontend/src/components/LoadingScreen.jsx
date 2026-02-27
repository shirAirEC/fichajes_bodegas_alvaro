import styles from './LoadingScreen.module.css';

export default function LoadingScreen() {
  return (
    <div className={styles.container}>
      <img src="/logo.svg" alt="Bodegas Álvaro" className={styles.logo} />
      <div className={styles.spinner}></div>
    </div>
  );
}
