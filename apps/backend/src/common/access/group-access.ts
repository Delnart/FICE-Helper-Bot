import {
  BadRequestException,
  ForbiddenException,
  Global,
  Injectable,
  Module,
} from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Role, ROLE_LEVEL } from '@fice/shared';
import { Subject, SubjectDocument, SubjectSchema } from '../../modules/subjects/subject.schema';
import { RequestUser } from '../types/request-user';

/** Canonical (lowercase) ObjectId hex — the form memberships and services compare by. */
const OBJECT_ID = /^[0-9a-f]{24}$/;

/**
 * Teacher lookups per request: the guard (x-group-id) and the controller's
 * assertAccess ask the same question. RequestUser lives for one request, so a
 * WeakMap keyed by it needs no TTL and can't serve stale roles across requests.
 */
const teachesCache = new WeakMap<RequestUser, Map<string, Promise<boolean>>>();

/**
 * The single answer to "may this user touch group X?". Every client-supplied
 * group id (x-group-id header, ?groupId=, body groupId) goes through here.
 */
@Injectable()
export class GroupAccessService {
  constructor(@InjectModel(Subject.name) private readonly subjects: Model<SubjectDocument>) {}

  /**
   * The user's membership role in the group; else Teacher when they teach a
   * subject there without being a member (teacher home switches the active
   * group to such groups); else null.
   */
  async roleIn(user: RequestUser, groupId: string): Promise<Role | null> {
    const m = user.memberships.find((x) => x.groupId === groupId);
    if (m) return m.role;
    // ?groupId[]=<id> arrives as an array, which test() would stringify into a pass.
    if (typeof groupId !== 'string' || !OBJECT_ID.test(groupId)) return null;
    let perUser = teachesCache.get(user);
    if (!perUser) teachesCache.set(user, (perUser = new Map()));
    let teaches = perUser.get(groupId);
    if (!teaches) {
      teaches = this.teaches(user.userId, groupId);
      perUser.set(groupId, teaches);
    }
    return (await teaches) ? Role.Teacher : null;
  }

  private async teaches(userId: string, groupId: string): Promise<boolean> {
    const hit = await this.subjects
      .exists({
        groupId: new Types.ObjectId(groupId),
        'teachers.teacherUserId': new Types.ObjectId(userId),
      })
      .exec();
    return hit !== null;
  }

  /** Returns `groupId` if the user has at least `minRole` there; 400 when missing, 403 otherwise. */
  async assertAccess(
    user: RequestUser,
    groupId: string | undefined,
    minRole: Role = Role.Student,
  ): Promise<string> {
    if (!groupId) throw new BadRequestException('No active group');
    const role = await this.roleIn(user, groupId);
    if (!role) throw new ForbiddenException('Немає доступу до цієї групи');
    if (ROLE_LEVEL[role] < ROLE_LEVEL[minRole]) {
      throw new ForbiddenException('Недостатньо прав у цій групі');
    }
    return groupId;
  }
}

@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: Subject.name, schema: SubjectSchema }])],
  providers: [GroupAccessService],
  exports: [GroupAccessService],
})
export class GroupAccessModule {}
