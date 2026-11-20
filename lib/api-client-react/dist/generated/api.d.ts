import type { QueryKey, UseMutationOptions, UseMutationResult, UseQueryOptions, UseQueryResult } from '@tanstack/react-query';
import type { AiKeySelectionRequest, AiStatus, AiUsage, ApiError, CircuitBuildChatInput, CircuitBuildChatResponse, CircuitBuilderHistoryImportInput, CircuitBuilderHistoryImportResponse, CircuitBuilderMemory, CircuitBuilderMemoryInput, CircuitPrompt, CircuitReviewRequest, CircuitReviewResponse, CircuitSpec, CircuitSymbolSearchResponse, HealthStatus, SearchCircuitSymbolsParams, TutorRequest, TutorResponse } from './api.schemas';
import { customFetch } from '../custom-fetch';
import type { ErrorType, BodyType } from '../custom-fetch';
type AwaitedInput<T> = PromiseLike<T> | T;
type Awaited<O> = O extends AwaitedInput<infer T> ? T : never;
type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];
export declare const getHealthCheckUrl: () => string;
/**
 * Returns server health status
 * @summary Health check
 */
export declare const healthCheck: (options?: Parameters<typeof customFetch>[1]) => Promise<HealthStatus>;
export declare const getHealthCheckQueryKey: () => readonly ["/api/healthz"];
export declare const getHealthCheckQueryOptions: <TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData> & {
    queryKey: QueryKey;
};
export type HealthCheckQueryResult = NonNullable<Awaited<ReturnType<typeof healthCheck>>>;
export type HealthCheckQueryError = ErrorType<unknown>;
/**
 * @summary Health check
 */
export declare function useHealthCheck<TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGenerateCircuitUrl: () => string;
/**
 * Converts a natural-language circuit description into a CircuitDraw-compatible schematic specification.
 * @summary Generate an editable circuit schematic
 */
export declare const generateCircuit: (circuitPrompt: CircuitPrompt, options?: Parameters<typeof customFetch>[1]) => Promise<CircuitSpec>;
export declare const getGenerateCircuitMutationKey: () => readonly ["generateCircuit"];
export declare const getGenerateCircuitMutationOptions: <TError = ErrorType<ApiError>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof generateCircuit>>, TError, GenerateCircuitMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof generateCircuit>>, TError, GenerateCircuitMutationVariables, TContext>;
export type GenerateCircuitMutationResult = NonNullable<Awaited<ReturnType<typeof generateCircuit>>>;
export type GenerateCircuitMutationBody = BodyType<CircuitPrompt>;
export type GenerateCircuitMutationError = ErrorType<ApiError>;
export type GenerateCircuitMutationVariables = {
    data: BodyType<CircuitPrompt>;
};
/**
* @summary Generate an editable circuit schematic
*/
export declare const useGenerateCircuit: <TError = ErrorType<ApiError>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof generateCircuit>>, TError, GenerateCircuitMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof generateCircuit>>, TError, GenerateCircuitMutationVariables, TContext>;
export declare const getSearchCircuitSymbolsUrl: (params?: SearchCircuitSymbolsParams) => string;
/**
 * @summary Search the KiCad schematic symbol library
 */
export declare const searchCircuitSymbols: (params?: SearchCircuitSymbolsParams, options?: Parameters<typeof customFetch>[1]) => Promise<CircuitSymbolSearchResponse>;
export declare const getSearchCircuitSymbolsQueryKey: (params?: SearchCircuitSymbolsParams) => readonly ["/api/circuits/library/search", ...SearchCircuitSymbolsParams[]];
export declare const getSearchCircuitSymbolsQueryOptions: <TData = Awaited<ReturnType<typeof searchCircuitSymbols>>, TError = ErrorType<ApiError>>(params?: SearchCircuitSymbolsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof searchCircuitSymbols>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof searchCircuitSymbols>>, TError, TData> & {
    queryKey: QueryKey;
};
export type SearchCircuitSymbolsQueryResult = NonNullable<Awaited<ReturnType<typeof searchCircuitSymbols>>>;
export type SearchCircuitSymbolsQueryError = ErrorType<ApiError>;
/**
 * @summary Search the KiCad schematic symbol library
 */
export declare function useSearchCircuitSymbols<TData = Awaited<ReturnType<typeof searchCircuitSymbols>>, TError = ErrorType<ApiError>>(params?: SearchCircuitSymbolsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof searchCircuitSymbols>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getAskCircuitTutorUrl: () => string;
/**
 * Returns educational guidance that separates visible evidence from inference. Optional edit proposals are validated CircuitSpecs and never applied automatically.
 * @summary Ask for an explanation of a circuit or image
 */
export declare const askCircuitTutor: (tutorRequest: TutorRequest, options?: Parameters<typeof customFetch>[1]) => Promise<TutorResponse>;
export declare const getAskCircuitTutorMutationKey: () => readonly ["askCircuitTutor"];
export declare const getAskCircuitTutorMutationOptions: <TError = ErrorType<ApiError>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof askCircuitTutor>>, TError, AskCircuitTutorMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof askCircuitTutor>>, TError, AskCircuitTutorMutationVariables, TContext>;
export type AskCircuitTutorMutationResult = NonNullable<Awaited<ReturnType<typeof askCircuitTutor>>>;
export type AskCircuitTutorMutationBody = BodyType<TutorRequest>;
export type AskCircuitTutorMutationError = ErrorType<ApiError>;
export type AskCircuitTutorMutationVariables = {
    data: BodyType<TutorRequest>;
};
/**
* @summary Ask for an explanation of a circuit or image
*/
export declare const useAskCircuitTutor: <TError = ErrorType<ApiError>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof askCircuitTutor>>, TError, AskCircuitTutorMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof askCircuitTutor>>, TError, AskCircuitTutorMutationVariables, TContext>;
export declare const getChatWithCircuitBuilderUrl: () => string;
/**
 * Maintains a concise design brief and, in Build mode, may return a validated CircuitSpec proposal that the user must review and apply.
 * @summary Clarify circuit requirements or propose a circuit edit
 */
export declare const chatWithCircuitBuilder: (circuitBuildChatInput: CircuitBuildChatInput, options?: Parameters<typeof customFetch>[1]) => Promise<CircuitBuildChatResponse>;
export declare const getChatWithCircuitBuilderMutationKey: () => readonly ["chatWithCircuitBuilder"];
export declare const getChatWithCircuitBuilderMutationOptions: <TError = ErrorType<ApiError>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof chatWithCircuitBuilder>>, TError, ChatWithCircuitBuilderMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof chatWithCircuitBuilder>>, TError, ChatWithCircuitBuilderMutationVariables, TContext>;
export type ChatWithCircuitBuilderMutationResult = NonNullable<Awaited<ReturnType<typeof chatWithCircuitBuilder>>>;
export type ChatWithCircuitBuilderMutationBody = BodyType<CircuitBuildChatInput>;
export type ChatWithCircuitBuilderMutationError = ErrorType<ApiError>;
export type ChatWithCircuitBuilderMutationVariables = {
    data: BodyType<CircuitBuildChatInput>;
};
/**
* @summary Clarify circuit requirements or propose a circuit edit
*/
export declare const useChatWithCircuitBuilder: <TError = ErrorType<ApiError>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof chatWithCircuitBuilder>>, TError, ChatWithCircuitBuilderMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof chatWithCircuitBuilder>>, TError, ChatWithCircuitBuilderMutationVariables, TContext>;
export declare const getListCircuitBuilderMemoriesUrl: () => string;
/**
 * @summary List saved Circuit Studio assumptions
 */
export declare const listCircuitBuilderMemories: (options?: Parameters<typeof customFetch>[1]) => Promise<CircuitBuilderMemory[]>;
export declare const getListCircuitBuilderMemoriesQueryKey: () => readonly ["/api/circuit-builder/memories"];
export declare const getListCircuitBuilderMemoriesQueryOptions: <TData = Awaited<ReturnType<typeof listCircuitBuilderMemories>>, TError = ErrorType<ApiError>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listCircuitBuilderMemories>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listCircuitBuilderMemories>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListCircuitBuilderMemoriesQueryResult = NonNullable<Awaited<ReturnType<typeof listCircuitBuilderMemories>>>;
export type ListCircuitBuilderMemoriesQueryError = ErrorType<ApiError>;
/**
 * @summary List saved Circuit Studio assumptions
 */
export declare function useListCircuitBuilderMemories<TData = Awaited<ReturnType<typeof listCircuitBuilderMemories>>, TError = ErrorType<ApiError>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listCircuitBuilderMemories>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getClearCircuitBuilderMemoriesUrl: () => string;
/**
 * @summary Delete all saved Circuit Studio assumptions
 */
export declare const clearCircuitBuilderMemories: (options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getClearCircuitBuilderMemoriesMutationKey: () => readonly ["clearCircuitBuilderMemories"];
export declare const getClearCircuitBuilderMemoriesMutationOptions: <TError = ErrorType<ApiError>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof clearCircuitBuilderMemories>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof clearCircuitBuilderMemories>>, TError, void, TContext>;
export type ClearCircuitBuilderMemoriesMutationResult = NonNullable<Awaited<ReturnType<typeof clearCircuitBuilderMemories>>>;
export type ClearCircuitBuilderMemoriesMutationError = ErrorType<ApiError>;
/**
* @summary Delete all saved Circuit Studio assumptions
*/
export declare const useClearCircuitBuilderMemories: <TError = ErrorType<ApiError>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof clearCircuitBuilderMemories>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof clearCircuitBuilderMemories>>, TError, void, TContext>;
export declare const getLearnFromCircuitBuilderHistoryUrl: () => string;
/**
 * Analyzes short summaries of recent local conversations and stores only reusable assumptions, not transcripts.
 * @summary Learn reusable assumptions from saved chats
 */
export declare const learnFromCircuitBuilderHistory: (circuitBuilderHistoryImportInput: CircuitBuilderHistoryImportInput, options?: Parameters<typeof customFetch>[1]) => Promise<CircuitBuilderHistoryImportResponse>;
export declare const getLearnFromCircuitBuilderHistoryMutationKey: () => readonly ["learnFromCircuitBuilderHistory"];
export declare const getLearnFromCircuitBuilderHistoryMutationOptions: <TError = ErrorType<ApiError>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof learnFromCircuitBuilderHistory>>, TError, LearnFromCircuitBuilderHistoryMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof learnFromCircuitBuilderHistory>>, TError, LearnFromCircuitBuilderHistoryMutationVariables, TContext>;
export type LearnFromCircuitBuilderHistoryMutationResult = NonNullable<Awaited<ReturnType<typeof learnFromCircuitBuilderHistory>>>;
export type LearnFromCircuitBuilderHistoryMutationBody = BodyType<CircuitBuilderHistoryImportInput>;
export type LearnFromCircuitBuilderHistoryMutationError = ErrorType<ApiError>;
export type LearnFromCircuitBuilderHistoryMutationVariables = {
    data: BodyType<CircuitBuilderHistoryImportInput>;
};
/**
* @summary Learn reusable assumptions from saved chats
*/
export declare const useLearnFromCircuitBuilderHistory: <TError = ErrorType<ApiError>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof learnFromCircuitBuilderHistory>>, TError, LearnFromCircuitBuilderHistoryMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof learnFromCircuitBuilderHistory>>, TError, LearnFromCircuitBuilderHistoryMutationVariables, TContext>;
export declare const getUpdateCircuitBuilderMemoryUrl: (id: number) => string;
/**
 * @summary Edit a saved Circuit Studio assumption
 */
export declare const updateCircuitBuilderMemory: (id: number, circuitBuilderMemoryInput: CircuitBuilderMemoryInput, options?: Parameters<typeof customFetch>[1]) => Promise<CircuitBuilderMemory>;
export declare const getUpdateCircuitBuilderMemoryMutationKey: () => readonly ["updateCircuitBuilderMemory"];
export declare const getUpdateCircuitBuilderMemoryMutationOptions: <TError = ErrorType<ApiError>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateCircuitBuilderMemory>>, TError, UpdateCircuitBuilderMemoryMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateCircuitBuilderMemory>>, TError, UpdateCircuitBuilderMemoryMutationVariables, TContext>;
export type UpdateCircuitBuilderMemoryMutationResult = NonNullable<Awaited<ReturnType<typeof updateCircuitBuilderMemory>>>;
export type UpdateCircuitBuilderMemoryMutationBody = BodyType<CircuitBuilderMemoryInput>;
export type UpdateCircuitBuilderMemoryMutationError = ErrorType<ApiError>;
export type UpdateCircuitBuilderMemoryMutationVariables = {
    id: number;
    data: BodyType<CircuitBuilderMemoryInput>;
};
/**
* @summary Edit a saved Circuit Studio assumption
*/
export declare const useUpdateCircuitBuilderMemory: <TError = ErrorType<ApiError>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateCircuitBuilderMemory>>, TError, UpdateCircuitBuilderMemoryMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateCircuitBuilderMemory>>, TError, UpdateCircuitBuilderMemoryMutationVariables, TContext>;
export declare const getDeleteCircuitBuilderMemoryUrl: (id: number) => string;
/**
 * @summary Delete a saved Circuit Studio assumption
 */
export declare const deleteCircuitBuilderMemory: (id: number, options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getDeleteCircuitBuilderMemoryMutationKey: () => readonly ["deleteCircuitBuilderMemory"];
export declare const getDeleteCircuitBuilderMemoryMutationOptions: <TError = ErrorType<ApiError>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteCircuitBuilderMemory>>, TError, DeleteCircuitBuilderMemoryMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteCircuitBuilderMemory>>, TError, DeleteCircuitBuilderMemoryMutationVariables, TContext>;
export type DeleteCircuitBuilderMemoryMutationResult = NonNullable<Awaited<ReturnType<typeof deleteCircuitBuilderMemory>>>;
export type DeleteCircuitBuilderMemoryMutationError = ErrorType<ApiError>;
export type DeleteCircuitBuilderMemoryMutationVariables = {
    id: number;
};
/**
* @summary Delete a saved Circuit Studio assumption
*/
export declare const useDeleteCircuitBuilderMemory: <TError = ErrorType<ApiError>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteCircuitBuilderMemory>>, TError, DeleteCircuitBuilderMemoryMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteCircuitBuilderMemory>>, TError, DeleteCircuitBuilderMemoryMutationVariables, TContext>;
export declare const getReviewCircuitUrl: () => string;
/**
 * Returns a concise educational review of a structurally valid draft. It does not check electrical safety or correctness.
 * @summary Review a valid circuit draft
 */
export declare const reviewCircuit: (circuitReviewRequest: CircuitReviewRequest, options?: Parameters<typeof customFetch>[1]) => Promise<CircuitReviewResponse>;
export declare const getReviewCircuitMutationKey: () => readonly ["reviewCircuit"];
export declare const getReviewCircuitMutationOptions: <TError = ErrorType<ApiError>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof reviewCircuit>>, TError, ReviewCircuitMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof reviewCircuit>>, TError, ReviewCircuitMutationVariables, TContext>;
export type ReviewCircuitMutationResult = NonNullable<Awaited<ReturnType<typeof reviewCircuit>>>;
export type ReviewCircuitMutationBody = BodyType<CircuitReviewRequest>;
export type ReviewCircuitMutationError = ErrorType<ApiError>;
export type ReviewCircuitMutationVariables = {
    data: BodyType<CircuitReviewRequest>;
};
/**
* @summary Review a valid circuit draft
*/
export declare const useReviewCircuit: <TError = ErrorType<ApiError>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof reviewCircuit>>, TError, ReviewCircuitMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof reviewCircuit>>, TError, ReviewCircuitMutationVariables, TContext>;
export declare const getGetAiUsageUrl: () => string;
/**
 * @summary Read the signed-in account's AI usage and selected key
 */
export declare const getAiUsage: (options?: Parameters<typeof customFetch>[1]) => Promise<AiUsage>;
export declare const getGetAiUsageQueryKey: () => readonly ["/api/ai/usage"];
export declare const getGetAiUsageQueryOptions: <TData = Awaited<ReturnType<typeof getAiUsage>>, TError = ErrorType<ApiError>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAiUsage>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getAiUsage>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetAiUsageQueryResult = NonNullable<Awaited<ReturnType<typeof getAiUsage>>>;
export type GetAiUsageQueryError = ErrorType<ApiError>;
/**
 * @summary Read the signed-in account's AI usage and selected key
 */
export declare function useGetAiUsage<TData = Awaited<ReturnType<typeof getAiUsage>>, TError = ErrorType<ApiError>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAiUsage>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetAiStatusUrl: () => string;
/**
 * @summary Check Gemini model availability without generating content
 */
export declare const getAiStatus: (options?: Parameters<typeof customFetch>[1]) => Promise<AiStatus>;
export declare const getGetAiStatusQueryKey: () => readonly ["/api/ai/status"];
export declare const getGetAiStatusQueryOptions: <TData = Awaited<ReturnType<typeof getAiStatus>>, TError = ErrorType<ApiError>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAiStatus>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getAiStatus>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetAiStatusQueryResult = NonNullable<Awaited<ReturnType<typeof getAiStatus>>>;
export type GetAiStatusQueryError = ErrorType<ApiError>;
/**
 * @summary Check Gemini model availability without generating content
 */
export declare function useGetAiStatus<TData = Awaited<ReturnType<typeof getAiStatus>>, TError = ErrorType<ApiError>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAiStatus>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getSetAiKeySelectionUrl: () => string;
/**
 * @summary Select a configured Gemini key for this account
 */
export declare const setAiKeySelection: (aiKeySelectionRequest: AiKeySelectionRequest, options?: Parameters<typeof customFetch>[1]) => Promise<AiUsage>;
export declare const getSetAiKeySelectionMutationKey: () => readonly ["setAiKeySelection"];
export declare const getSetAiKeySelectionMutationOptions: <TError = ErrorType<ApiError>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof setAiKeySelection>>, TError, SetAiKeySelectionMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof setAiKeySelection>>, TError, SetAiKeySelectionMutationVariables, TContext>;
export type SetAiKeySelectionMutationResult = NonNullable<Awaited<ReturnType<typeof setAiKeySelection>>>;
export type SetAiKeySelectionMutationBody = BodyType<AiKeySelectionRequest>;
export type SetAiKeySelectionMutationError = ErrorType<ApiError>;
export type SetAiKeySelectionMutationVariables = {
    data: BodyType<AiKeySelectionRequest>;
};
/**
* @summary Select a configured Gemini key for this account
*/
export declare const useSetAiKeySelection: <TError = ErrorType<ApiError>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof setAiKeySelection>>, TError, SetAiKeySelectionMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof setAiKeySelection>>, TError, SetAiKeySelectionMutationVariables, TContext>;
export {};
//# sourceMappingURL=api.d.ts.map