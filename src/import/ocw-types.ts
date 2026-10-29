/**
 * Shapes as they appear in an OCW archive's `data.json` files.
 *
 * These mirror the `coursedata` Hugo output format: a page's front-matter params
 * merged with its rendered content. Everything is optional — archives vary by
 * vintage, and the parser is responsible for coping rather than trusting.
 */

export interface OcwCourseData {
  course_title?: string;
  primary_course_number?: string;
  extra_course_numbers?: string;
  term?: string;
  year?: string | number;
  level?: string[];
  topics?: string[][] | string[];
  course_description?: string;
  course_description_html?: string;
  instructors?: unknown;
  site_uid?: string;
  site_short_id?: string;
  legacy_uid?: string;
  department_numbers?: string[];
  learning_resource_types?: string[];
  license?: string;
  /** Relative path to the course image, e.g. "./static_resources/…jpg". */
  image_src?: string;
  site_url_path?: string;
}

export interface OcwVideoMetadata {
  youtube_id?: string;
  youtube_description?: string;
  video_speakers?: string;
}

export interface OcwPageData {
  uid?: string;
  title?: string;
  description?: string;
  parent_uid?: string;
  draft?: boolean;
  content?: string;
  content_type?: string;
  learning_resource_types?: string[];
  license?: string;
  language?: string;
  locale?: string;

  /** Present on resources only. */
  resourcetype?: string;
  /** Null for videos, which ship no file. */
  file?: string | null;
  file_type?: string;
  /** A number in some records and a numeric string in others. */
  file_size?: number | string | null;
  video_metadata?: OcwVideoMetadata;
  video_files?: OcwVideoFiles;
  /** Resource lists and video galleries reference other content by uid. */
  resources?: { content?: string[]; website?: string };
  videos?: { content?: string[]; website?: string };
}

export interface OcwVideoFiles {
  archive_url?: string;
  video_captions_file?: string;
  video_transcript_file?: string;
  video_thumbnail_file?: string;
}

/**
 * content_map.json: content uid -> where that content's data.json was published,
 * e.g. "/resources/lecture-1/data.json". Strip the filename for the page's path.
 */
export type OcwContentMap = Record<string, string>;
