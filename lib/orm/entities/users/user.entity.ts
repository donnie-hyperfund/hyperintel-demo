import {
    Collection,
    Entity,
    Enum,
    OneToMany,
    OneToOne,
    Property,
    Rel,
    raw,
    SelectQueryBuilder,
} from '@mikro-orm/postgresql';
import { type Nullable } from '@/common/orm/utils';
import { IdCreatedUpdatedColumns } from '@/lib/orm/entities/columns.entity';

@Entity({ tableName: 'users' })
export class UserEntity extends IdCreatedUpdatedColumns {
    @Property({ type: 'text' })
    email!: string;

    @Property({ type: 'boolean', default: false })
    emailConfirmed!: boolean;

    @Property({ type: 'text', nullable: true })
    role?: Nullable<string>;

    @Property({ type: 'text', nullable: true })
    name?: Nullable<string>;
}
