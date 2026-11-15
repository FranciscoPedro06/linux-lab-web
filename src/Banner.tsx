import styles from './Banner.module.css'

// What `figlet -k Linux Lab` prints with the standard font. Screen readers get the name.
const FIGLET = [
  ' _      _                         _            _',
  '| |    (_) _ __   _   _ __  __   | |     __ _ | |__',
  "| |    | || '_ \\ | | | |\\ \\/ /   | |    / _` || '_ \\",
  '| |___ | || | | || |_| | >  <    | |___| (_| || |_) |',
  '|_____||_||_| |_| \\__,_|/_/\\_\\   |_____|\\__,_||_.__/',
].join('\n')

export function Banner() {
  return (
    <h1 className={styles.banner}>
      <span className={styles.art} aria-hidden="true">
        {FIGLET}
      </span>
      <span className={styles.name}>Linux Lab</span>
    </h1>
  )
}
