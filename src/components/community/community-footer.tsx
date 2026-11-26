import Link from "next/link";
import { Brand } from "@/components/brand";
import { Icon } from "@/components/ui/icon";
import { RiverLines } from "./river-lines";
import { communityUrl } from "@/lib/demo-content";

export function CommunityFooter({
  demo = false,
  onAbout,
}: {
  demo?: boolean;
  onAbout?: () => void;
}) {
  return (
    <footer className="cm-footer">
      <RiverLines className="cm-footer-river" />
      <div className="cm-container">
        <div className="cm-footer-top">
          <div>
            <Link href="/" className="brand-link">
              <Brand compact />
            </Link>
            <p>
              Здесь всё, чем живёт город.
              <br />И люди, которым он дорог.
            </p>
          </div>
          <div className="cm-footer-links">
            <strong>Наше сообщество</strong>
            {onAbout ? (
              <button onClick={onAbout}>О проекте</button>
            ) : (
              <Link href="/">Лента города</Link>
            )}
            <Link href="/suggest-news">Предложить публикацию</Link>
            <a
              href="/image-credits.txt"
              target="_blank"
              rel="noopener noreferrer"
            >
              Авторы фотографий
            </a>
          </div>
          <div className="cm-footer-links">
            <strong>Остаёмся на связи</strong>
            <a
              href={communityUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="cm-vk-link"
            >
              <Icon name="vk" size={22} />
              my_kineshma
              <Icon name="external" size={14} />
            </a>
            <Link href={demo ? "/" : "/demo"}>
              {demo ? "К настоящим публикациям" : "Примеры оформления"}
            </Link>
          </div>
        </div>
        <div className="cm-footer-bottom">
          <span>© Моя Кинешма · Город. Люди. События.</span>
          <span>
            {demo
              ? "Демонстрационные материалы — не реальные сообщения о событиях."
              : "Истории жителей. Знакомые места. Наше городское сообщество."}
          </span>
        </div>
      </div>
    </footer>
  );
}
