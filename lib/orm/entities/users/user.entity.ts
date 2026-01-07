import {
    Collection,
    Entity,
    Enum,
    OneToMany,
    OneToOne,
    Property,
    raw,
    Rel,
    SelectQueryBuilder,
} from '@mikro-orm/postgresql';
import { IdCreatedUpdatedColumns } from '@/lib/orm/entities/columns.entity';
import { type Nullable } from '@/common/orm/utils';


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

