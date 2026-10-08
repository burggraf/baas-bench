-- Native ACLs must bind last_actor_id to the authenticated application user.
-- A null actor is reserved for administrative fixture import/reset.
DROP TABLE IF EXISTS activities;
DROP TABLE IF EXISTS comments;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS memberships;
DROP TABLE IF EXISTS organizations;
DROP TABLE IF EXISTS users;
CREATE TABLE users (id INTEGER PRIMARY KEY, external_id TEXT UNIQUE NOT NULL, auth_subject TEXT UNIQUE, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL CHECK(length(display_name)>0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;
CREATE TABLE organizations (id INTEGER PRIMARY KEY, external_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL CHECK(length(name)>0), owner_id TEXT NOT NULL REFERENCES users(external_id), created_at TEXT NOT NULL) STRICT;
CREATE TABLE memberships (id INTEGER PRIMARY KEY, external_id TEXT UNIQUE NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(external_id), user_id TEXT NOT NULL REFERENCES users(external_id), role TEXT NOT NULL CHECK(role IN ('owner','admin','member')), created_at TEXT NOT NULL, revoked_at TEXT, UNIQUE(organization_id,user_id)) STRICT;
CREATE TABLE projects (id INTEGER PRIMARY KEY, external_id TEXT UNIQUE NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(external_id), name TEXT NOT NULL CHECK(length(name)>0), status TEXT NOT NULL CHECK(status IN ('active','archived')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(external_id,organization_id)) STRICT;
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY, external_id TEXT UNIQUE NOT NULL, organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL, creator_id TEXT NOT NULL, assignee_id TEXT,
  title TEXT NOT NULL CHECK(length(title)>0), description TEXT NOT NULL CHECK(length(description)>0),
  status TEXT NOT NULL CHECK(status IN ('todo','in_progress','done','cancelled')),
  priority TEXT NOT NULL CHECK(priority IN ('low','medium','high','urgent')), due_date TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_actor_id TEXT,
  FOREIGN KEY(project_id,organization_id) REFERENCES projects(external_id,organization_id),
  FOREIGN KEY(organization_id,creator_id) REFERENCES memberships(organization_id,user_id),
  FOREIGN KEY(organization_id,assignee_id) REFERENCES memberships(organization_id,user_id),
  FOREIGN KEY(organization_id,last_actor_id) REFERENCES memberships(organization_id,user_id),
  UNIQUE(external_id,project_id,organization_id)
) STRICT;
CREATE TABLE comments (
  id INTEGER PRIMARY KEY, external_id TEXT UNIQUE NOT NULL, organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL, task_id TEXT NOT NULL, author_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK(length(body)>0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_actor_id TEXT,
  FOREIGN KEY(task_id,project_id,organization_id) REFERENCES tasks(external_id,project_id,organization_id),
  FOREIGN KEY(organization_id,author_id) REFERENCES memberships(organization_id,user_id),
  FOREIGN KEY(organization_id,last_actor_id) REFERENCES memberships(organization_id,user_id)
) STRICT;
CREATE TABLE activities (
  id INTEGER PRIMARY KEY, external_id TEXT UNIQUE NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(external_id),
  project_id TEXT, actor_id TEXT NOT NULL, action TEXT NOT NULL, subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY(project_id,organization_id) REFERENCES projects(external_id,organization_id),
  FOREIGN KEY(organization_id,actor_id) REFERENCES memberships(organization_id,user_id)
) STRICT;
CREATE INDEX memberships_user_idx ON memberships(user_id,organization_id);
CREATE INDEX projects_organization_idx ON projects(organization_id,created_at,external_id);
CREATE INDEX tasks_tenant_idx ON tasks(organization_id,project_id,created_at,external_id);
CREATE INDEX tasks_assignee_idx ON tasks(organization_id,assignee_id);
CREATE INDEX comments_task_idx ON comments(organization_id,project_id,task_id,created_at,external_id);
CREATE INDEX activities_project_idx ON activities(organization_id,project_id,created_at,external_id);
CREATE TRIGGER tasks_insert_activity AFTER INSERT ON tasks WHEN NEW.last_actor_id IS NOT NULL BEGIN
  INSERT INTO activities(external_id,organization_id,project_id,actor_id,action,subject_type,subject_id,created_at)
  VALUES('wrv5'||lower(hex(randomblob(16))),NEW.organization_id,NEW.project_id,NEW.last_actor_id,'created','task',NEW.external_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER tasks_update_activity AFTER UPDATE ON tasks WHEN NEW.last_actor_id IS NOT NULL BEGIN
  INSERT INTO activities(external_id,organization_id,project_id,actor_id,action,subject_type,subject_id,created_at)
  VALUES('wrv5'||lower(hex(randomblob(16))),NEW.organization_id,NEW.project_id,NEW.last_actor_id,'updated','task',NEW.external_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER comments_insert_activity AFTER INSERT ON comments WHEN NEW.last_actor_id IS NOT NULL BEGIN
  INSERT INTO activities(external_id,organization_id,project_id,actor_id,action,subject_type,subject_id,created_at)
  VALUES('wrv5'||lower(hex(randomblob(16))),NEW.organization_id,NEW.project_id,NEW.last_actor_id,'commented','task',NEW.task_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER comments_update_activity AFTER UPDATE ON comments WHEN NEW.last_actor_id IS NOT NULL BEGIN
  INSERT INTO activities(external_id,organization_id,project_id,actor_id,action,subject_type,subject_id,created_at)
  VALUES('wrv5'||lower(hex(randomblob(16))),NEW.organization_id,NEW.project_id,NEW.last_actor_id,'comment_updated','task',NEW.task_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
