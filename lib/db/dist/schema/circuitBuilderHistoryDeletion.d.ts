import { z } from "zod/v4";
export declare const circuitBuilderHistoryDeletions: import("drizzle-orm/pg-core").PgTableWithColumns<{
    name: "circuit_studio_history_deletions";
    schema: undefined;
    columns: {
        userId: import("drizzle-orm/pg-core").PgColumn<{
            name: "user_id";
            tableName: "circuit_studio_history_deletions";
            dataType: "string";
            columnType: "PgText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        sessionId: import("drizzle-orm/pg-core").PgColumn<{
            name: "session_id";
            tableName: "circuit_studio_history_deletions";
            dataType: "string";
            columnType: "PgText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        deletedAt: import("drizzle-orm/pg-core").PgColumn<{
            name: "deleted_at";
            tableName: "circuit_studio_history_deletions";
            dataType: "date";
            columnType: "PgTimestamp";
            data: Date;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
    };
    dialect: "pg";
}>;
export declare const insertCircuitBuilderHistoryDeletionSchema: z.ZodObject<{
    userId: z.ZodString;
    sessionId: z.ZodString;
}, {
    out: {};
    in: {};
}>;
export type InsertCircuitBuilderHistoryDeletion = z.infer<typeof insertCircuitBuilderHistoryDeletionSchema>;
export type CircuitBuilderHistoryDeletion = typeof circuitBuilderHistoryDeletions.$inferSelect;
//# sourceMappingURL=circuitBuilderHistoryDeletion.d.ts.map