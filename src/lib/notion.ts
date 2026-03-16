import { Client } from '@notionhq/client';
import { NotionToMarkdown } from 'notion-to-md';
import { marked } from 'marked';

const notion = new Client({ auth: import.meta.env.NOTION_TOKEN });
const n2m = new NotionToMarkdown({ notionClient: notion });

const DATABASE_ID = import.meta.env.NOTION_DATABASE_ID;

export interface NotionPost {
  id: string;
  title: string;
  description: string;
  author: string;
  date: string;
  category: string;
  readTime: string;
  image: string;
  slug: string;
  lang: string;
  tags: string[];
  seoScore: number;
}

function extractProperty(page: any, name: string, type: string): any {
  const prop = page.properties[name];
  if (!prop) return null;

  switch (type) {
    case 'title':
      return prop.title?.map((t: any) => t.plain_text).join('') || '';
    case 'rich_text':
      return prop.rich_text?.map((t: any) => t.plain_text).join('') || '';
    case 'select':
      return prop.select?.name || '';
    case 'date':
      return prop.date?.start || '';
    case 'url':
      return prop.url || '';
    case 'checkbox':
      return prop.checkbox ?? false;
    case 'multi_select':
      return prop.multi_select?.map((s: any) => s.name) || [];
    case 'number':
      return prop.number ?? 0;
    case 'people':
      return prop.people?.map((p: any) => p.name).join(', ') || '';
    default:
      return null;
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function pageToPost(page: any): NotionPost {
  const rawSlug = extractProperty(page, 'Slug', 'rich_text');
  const title = extractProperty(page, 'Title', 'title');
  return {
    id: page.id,
    title,
    description: extractProperty(page, 'Description', 'rich_text'),
    author: extractProperty(page, 'Author', 'people'),
    date: extractProperty(page, 'Date', 'date'),
    category: extractProperty(page, 'Category', 'select'),
    readTime: extractProperty(page, 'ReadTime', 'rich_text'),
    image: extractProperty(page, 'Image', 'url'),
    slug: rawSlug ? slugify(rawSlug) : slugify(title),
    lang: extractProperty(page, 'Lang', 'select'),
    tags: extractProperty(page, 'Tags', 'multi_select'),
    seoScore: extractProperty(page, 'SEO Score', 'number'),
  };
}

export async function fetchPublishedPosts(lang?: string, excludeCategory?: string): Promise<NotionPost[]> {
  const filter: any = {
    and: [
      { property: 'Published', checkbox: { equals: true } },
    ],
  };

  if (lang) {
    filter.and.push({ property: 'Lang', select: { equals: lang } });
  }

  if (excludeCategory) {
    filter.and.push({ property: 'Category', select: { does_not_equal: excludeCategory } });
  }

  const response = await notion.databases.query({
    database_id: DATABASE_ID,
    filter,
    sorts: [{ property: 'Date', direction: 'descending' }],
  });

  return response.results.map(pageToPost);
}

export async function fetchPostBySlug(slug: string): Promise<NotionPost | null> {
  const response = await notion.databases.query({
    database_id: DATABASE_ID,
    filter: {
      property: 'Published',
      checkbox: { equals: true },
    },
  });

  const posts = response.results.map(pageToPost);
  return posts.find((p) => p.slug === slug) ?? null;
}

export async function fetchPostContent(pageId: string): Promise<string> {
  const mdBlocks = await n2m.pageToMarkdown(pageId);
  const mdString = n2m.toMarkdownString(mdBlocks);
  return await marked(mdString.parent);
}
