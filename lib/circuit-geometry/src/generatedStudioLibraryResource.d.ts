export type StudioLibraryResearchStatus = 'catalog_reference' | 'needs_review' | 'corrected';
export type StudioLibraryResearchEntry = {
  shortDescription: string;
  longDescription: string;
  keywords: string[];
  researchStatus: StudioLibraryResearchStatus;
};
export const STUDIO_LIBRARY_RESEARCH: Record<string, StudioLibraryResearchEntry>;
