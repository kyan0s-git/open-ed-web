import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearch as useRouteSearch } from "@tanstack/react-router";
import { useSearch } from "@/search/client";
import type { SearchHit, SearchKind, Segment } from "@/search/engine";
import { useIndexStatus } from "@/search/pdf-indexer";
import { useCourseSummaries } from "@/storage/queries";
import { Icon } from "@/ui/icons";

const FILTERS: { value: string; label: string; kinds?: SearchKind[] }[] = [
  { value: "", label: "Everything" },
  { value: "pdf", label: "Notes & PDFs", kinds: ["pdf"] },
  { value: "transcript", label: "Lecture transcripts", kinds: ["transcript"] },
  { value: "pages", label: "Pages & materials", kinds: ["course", "page", "material"] },
];

/**
 * Search across every imported course: page text, material titles, and the text of
 * every PDF page, including video transcripts. Results update as you type and the
 * query lives in the URL, so a search can be bookmarked or returned to with Back.
 */
export function SearchPage() {
  const params = useRouteSearch({ from: "/search" });
  const navigate = useNavigate({ from: "/search" });
  const [query, setQuery] = useState(params.q ?? "");
  const input = useRef<HTMLInputElement>(null);
  const summaries = useCourseSummaries();
  const indexing = useIndexStatus();

  const filter = FILTERS.find((f) => f.value === (params.kind ?? "")) ?? FILTERS[0]!;
  // While PDFs are still being indexed, re-run the query as their text arrives.
  const refreshKey = indexing ? Math.floor(indexing.done / 5) : -1;
  const { hits, loading } = useSearch(query, { courseId: params.course, kinds: filter.kinds }, refreshKey);

  useEffect(() => input.current?.focus(), []);

  // Keep the URL in step with the box, without stacking a history entry per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      if ((params.q ?? "") !== query) {
        void navigate({ search: (prev) => ({ ...prev, q: query || undefined }), replace: true });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, params.q, navigate]);

  const courseTitle = summaries?.find((s) => s.course.id === params.course)?.course.title;
  const searched = query.trim().length >= 2;

  return (
    <div className="page page--narrow">
      <p className="eyebrow">Search</p>
      <form
        className="searchbox"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          void navigate({ search: (prev) => ({ ...prev, q: query || undefined }) });
        }}
      >
        <Icon name="search" />
        <input
          ref={input}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={courseTitle ? `Search ${courseTitle}` : "Search lectures, notes and transcripts"}
          aria-label="Search"
          autoComplete="off"
          spellCheck={false}
        />
        {query && (
          <button
            type="button"
            className="iconbtn"
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              input.current?.focus();
            }}
          >
            <Icon name="close" size={16} />
          </button>
        )}
      </form>

      <div className="search-filters">
        <div className="tabs" role="group" aria-label="What to search">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={option.value === filter.value}
              onClick={() =>
                void navigate({ search: (prev) => ({ ...prev, kind: option.value || undefined }), replace: true })
              }
            >
              {option.label}
            </button>
          ))}
        </div>

        {summaries && summaries.length > 1 && (
          <select
            className="select"
            value={params.course ?? ""}
            onChange={(event) =>
              void navigate({ search: (prev) => ({ ...prev, course: event.target.value || undefined }), replace: true })
            }
            aria-label="Course"
          >
            <option value="">All courses</option>
            {summaries.map(({ course }) => (
              <option key={course.id} value={course.id}>
                {course.courseNumber ? `${course.courseNumber} ${course.title}` : course.title}
              </option>
            ))}
          </select>
        )}
        {summaries?.length === 1 && params.course && (
          <button
            type="button"
            className="chip chip--button"
            onClick={() => void navigate({ search: (prev) => ({ ...prev, course: undefined }), replace: true })}
          >
            {courseTitle} <Icon name="close" size={12} />
          </button>
        )}
      </div>

      {searched && (
        <p className="muted search-count" aria-live="polite">
          {loading && hits.length === 0
            ? "Searching…"
            : hits.length === 0
              ? `Nothing found for “${query.trim()}”.`
              : `${hits.length === 60 ? "60+" : hits.length} ${hits.length === 1 ? "result" : "results"}`}
        </p>
      )}

      <ol className="results">
        {hits.map((hit) => (
          <Result key={hit.id} hit={hit} query={query} showCourse={!params.course && (summaries?.length ?? 0) > 1} />
        ))}
      </ol>

      {/* Below the results, so that when indexing finishes and this goes away, nothing
          the learner may be about to click moves. */}
      {indexing && (
        <p className="notice" role="status">
          Reading PDF text for search: {indexing.done} of {indexing.total} files. Results from lecture
          notes and transcripts will keep appearing.
        </p>
      )}

      {!searched && <Tips />}
    </div>
  );
}

function Result({ hit, query, showCourse }: { hit: SearchHit; query: string; showCourse: boolean }) {
  const where = [showCourse ? hit.courseTitle : null, hit.parent].filter(Boolean).join(" › ");
  const label =
    hit.kind === "transcript"
      ? `Transcript · page ${hit.page}`
      : hit.kind === "pdf"
        ? `PDF · page ${hit.page}`
        : hit.kind === "course"
          ? "Course"
          : hit.kind === "material"
            ? (hit.detail ?? "Material")
            : "Page";

  const body = (
    <>
      <span className="result__meta">
        <span className="result__kind">{label}</span>
        {where && <span>{where}</span>}
      </span>
      <span className="result__title">
        <Marked segments={hit.titleSegments} />
      </span>
      {hit.snippet.length > 0 && (
        <span className="result__snippet">
          <Marked segments={hit.snippet} />
        </span>
      )}
    </>
  );

  if (hit.kind === "course") {
    return (
      <li>
        <Link className="result" to="/c/$courseId" params={{ courseId: hit.courseId }}>
          {body}
        </Link>
      </li>
    );
  }

  return (
    <li>
      <Link
        className="result"
        to="/c/$courseId/p/$pageUid"
        params={{ courseId: hit.courseId, pageUid: hit.uid }}
        search={{ page: hit.page, q: query.trim() || undefined }}
      >
        {body}
      </Link>
    </li>
  );
}

/** Highlighted text from plain segments — course text never reaches the DOM as HTML. */
function Marked({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((segment, i) => (segment.match ? <mark key={i}>{segment.text}</mark> : <span key={i}>{segment.text}</span>))}
    </>
  );
}

function Tips() {
  return (
    <div className="search-tips muted">
      <p>Search covers page text, every material’s title, and the full text of lecture notes, problem sets and video transcripts.</p>
      <ul>
        <li>Accents are optional: <code>schrodinger</code> finds Schrödinger.</li>
        <li>Unfinished words match as you type, and small typos are forgiven.</li>
        <li>
          Press <kbd>/</kbd> anywhere to search.
        </li>
      </ul>
    </div>
  );
}
