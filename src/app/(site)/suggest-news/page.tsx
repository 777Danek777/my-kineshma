import type { Metadata } from "next";
import Link from "next/link";
import { CommunityHeader } from "@/components/community/community-header";
import { CommunityFooter } from "@/components/community/community-footer";
import { SubmissionForm } from "@/components/submissions/submission-form";
import { Icon } from "@/components/ui/icon";
import "./suggest.css";
import "../community.css";

export const metadata: Metadata = { title: "Поделиться с городом — Моя Кинешма", description: "Добавьте фотографию, видео или пару слов. Поделитесь своей историей с Кинешмой.", robots: { index: false, follow: false } };

export default function SuggestNewsPage() {
  return <div className="suggest-page community-site"><CommunityHeader /><main id="suggest-main" className="suggest-main"><Link className="suggest-back-link" href="/"><span aria-hidden="true">←</span> В ленту города</Link><div className="suggest-intro"><span className="suggest-eyebrow">СВОИ ИСТОРИИ. СВОЙ ГОРОД.</span><h1>Есть чем поделиться?</h1><p>Фотография, пара слов или целая история.<br />То, чем живёт ваша Кинешма.</p></div><SubmissionForm /><div className="suggest-under-form"><Icon name="info" size={17} /><p>Достаточно одного фото или текста. Заголовок, имя и контакт — по желанию.</p></div></main><CommunityFooter /></div>;
}
