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
  file?: string;
  file_type?: string;
  file_size?: number;
  video_metadata?: OcwVideoMetadata;
  video_files?: Record<string, unknown>;
  /** Resource lists and video galleries reference other content by uid. */
  resources?: { content?: string[]; website?: string };
  videos?: { content?: string[]; website?: string };
}

/** content_map.json: content uid -> published path. */
export type OcwContentMap = Record<string, string>;
