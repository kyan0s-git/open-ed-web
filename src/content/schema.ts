import { z } from "zod";

/**
 * The normalized course model. Everything the importer produces is validated
 * against these schemas before it reaches storage, so a malformed archive fails
 * at the boundary with a useful message instead of halfway through the reader.
 *
 * Field names deliberately mirror OCW's own vocabulary (uid, resourcetype,
 * learning_resource_types) where it is already clear, so the mapping from an
 * archive's `data.json` stays obvious.
 */

export const NodeKind = z.enum(["page", "section", "resource", "video_gallery"]);
export type NodeKind = z.infer<typeof NodeKind>;

export const ResourceType = z.enum(["Image", "Video", "Document", "Other"]);
export type ResourceType = z.infer<typeof ResourceType>;

export const Instructor = z.object({
  name: z.string(),
  title: z.string().optional(),
});

export const Course = z.object({
  id: z.string(),
  sourceHash: z.string(),
  title: z.string(),
  courseNumber: z.string().optional(),
  term: z.string().optional(),
  year: z.string().optional(),
  level: z.array(z.string()).default([]),
  topics: z.array(z.string()).default([]),
  instructors: z.array(Instructor).default([]),
  descriptionHtml: z.string().default(""),
  /** Rights statement from the archive. OCW is CC BY-NC-SA; the reader must show it. */
  license: z.string().optional(),
  importedAt: z.string(),
});
export type Course = z.infer<typeof Course>;

export const CourseNode = z.object({
  uid: z.string(),
  parentUid: z.string().nullable(),
  kind: NodeKind,
  title: z.string(),
  /** Sort key within the parent, from menu.leftnav weight where available. */
  order: z.number(),
  /** Site-relative path this node was published at, used to resolve links. */
  path: z.string(),
  learningResourceTypes: z.array(z.string()).default([]),
});
export type CourseNode = z.infer<typeof CourseNode>;

export const PageContent = z.object({
  uid: z.string(),
  /** Rendered HTML from the archive. Sanitized at render time, never at rest. */
  html: z.string(),
  /** Plain text, kept for the search index so we never re-strip HTML at query time. */
  text: z.string(),
  headings: z.array(z.object({ level: z.number(), text: z.string() })).default([]),
});
export type PageContent = z.infer<typeof PageContent>;

export const Resource = z.object({
  uid: z.string(),
  title: z.string(),
  resourcetype: ResourceType,
  /** Path of the file inside the archive. Empty for videos, which ship no file. */
  zipPath: z.string().nullable(),
  mime: z.string().optional(),
  sizeBytes: z.number().optional(),
  /** Videos are excluded from OCW archives, but their YouTube ID travels in metadata. */
  youtubeId: z.string().optional(),
  transcriptPath: z.string().nullable().default(null),
  captionsPath: z.string().nullable().default(null),
  language: z.string().optional(),
});
export type Resource = z.infer<typeof Resource>;

export const ExerciseChoice = z.object({
  html: z.string(),
  correct: z.boolean(),
});

export const ExerciseItem = z.object({
  id: z.string(),
  skillId: z.string(),
  /** A deliberate subset of Perseus's item shape, so a Perseus adapter stays possible. */
  type: z.enum(["radio", "numeric", "free"]),
  promptHtml: z.string(),
  choices: z.array(ExerciseChoice).default([]),
  source: z.enum(["ocw-quiz", "authored"]),
});
export type ExerciseItem = z.infer<typeof ExerciseItem>;

export const Skill = z.object({
  id: z.string(),
  courseId: z.string(),
  title: z.string(),
  /** Node this skill was derived from — the lecture or session page. */
  nodeUid: z.string(),
  order: z.number(),
});
export type Skill = z.infer<typeof Skill>;

export const CourseBundle = z.object({
  course: Course,
  nodes: z.array(CourseNode),
  pages: z.array(PageContent),
  resources: z.array(Resource),
  exercises: z.array(ExerciseItem),
  skills: z.array(Skill),
  /** Anything the importer chose to skip, surfaced in the import summary. */
  warnings: z.array(z.string()).default([]),
});
export type CourseBundle = z.infer<typeof CourseBundle>;
