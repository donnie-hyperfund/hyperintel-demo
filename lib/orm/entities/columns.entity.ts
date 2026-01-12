import { BaseEntity, Opt, PrimaryKey, Property } from '@mikro-orm/core';
import type { Nullable } from '@/common/orm/utils';

export class IdColumn extends BaseEntity {
    @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
    id!: string & Opt;
}

export class IdDeletedAtColumns extends IdColumn {
    @Property({ type: 'timestamptz', nullable: true })
    deleted_at!: Nullable<Date> & Opt;
}
export class IdCreatedColumns extends IdColumn {
    @Property({ type: 'timestamptz', length: 3, defaultRaw: 'now()', serializer: (value) => value.toISOString() })
    created_at!: Date & Opt;
}
export class IdCreatedDeletedAtColumns extends IdCreatedColumns {
    @Property({ type: 'timestamptz', nullable: true })
    deleted_at!: Nullable<Date> & Opt;
}
export abstract class IdCreatedUpdatedColumns extends IdCreatedColumns {
    @Property({
        type: 'timestamptz',
        length: 3,
        defaultRaw: 'now()',
        onUpdate: () => new Date(),
        serializer: (value) => value.toISOString(),
    })
    updated_at!: Date & Opt;
}
export class IdCreatedUpdatedDeletedAtColumns extends IdCreatedUpdatedColumns {
    @Property({ type: 'timestamptz', nullable: true })
    deleted_at!: Nullable<Date> & Opt;
}

export class CreatedAtColumn {
    @Property({ type: 'timestamptz', length: 3, defaultRaw: 'now()', serializer: (value) => value.toISOString() })
    created_at!: Date & Opt;
}
export abstract class CreatedUpdatedColumns extends CreatedAtColumn {
    @Property({
        type: 'timestamptz',
        length: 3,
        defaultRaw: 'now()',
        onUpdate: () => new Date(),
        serializer: (value) => value.toISOString(),
    })
    updated_at!: Date & Opt;
}
