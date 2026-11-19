import {randomBytes,randomUUID,scrypt as scryptCallback,createHash,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const scrypt=promisify(scryptCallback);
const SESSION_SECONDS=14*24*60*60;
const normalizeEmail=value=>typeof value==='string'?value.trim().toLowerCase():'';
const tokenHash=token=>createHash('sha256').update(token).digest('hex');

export function createAccountStore(file){
  mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const db=new DatabaseSync(file);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'free'
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL DEFAULT '', profession TEXT NOT NULL DEFAULT '',
      bio TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('personal','studio')),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspace_members (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('owner','admin','editor','viewer')),
      PRIMARY KEY(workspace_id,user_id)
    );
  `);
  db.exec('INSERT OR IGNORE INTO profiles (user_id,updated_at) SELECT id,created_at FROM users');
  for(const user of db.prepare("SELECT id,created_at FROM users WHERE id NOT IN (SELECT owner_id FROM workspaces WHERE type='personal')").all()){
    const workspaceId=randomUUID();
    db.exec('BEGIN IMMEDIATE');
    try{
      db.prepare('INSERT INTO workspaces (id,owner_id,name,type,created_at) VALUES (?,?,?,?,?)').run(workspaceId,user.id,'Personal workspace','personal',user.created_at);
      db.prepare('INSERT INTO workspace_members (workspace_id,user_id,role) VALUES (?,?,?)').run(workspaceId,user.id,'owner');
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  const byEmail=db.prepare('SELECT id,email,password_hash,created_at,plan FROM users WHERE email=?');
  const bySession=db.prepare('SELECT users.id,users.email,users.created_at,users.plan FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>?');
  const insertUser=db.prepare('INSERT INTO users (id,email,password_hash,created_at) VALUES (?,?,?,?)');
  const insertSession=db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)');
  const profileByUser=db.prepare('SELECT display_name,profession,bio FROM profiles WHERE user_id=?');
  const workspaceByUser=db.prepare("SELECT workspaces.id,workspaces.name,workspaces.type,workspace_members.role FROM workspaces JOIN workspace_members ON workspace_members.workspace_id=workspaces.id WHERE workspace_members.user_id=? AND workspaces.type='personal' LIMIT 1");
  const publicUser=user=>({id:user.id,email:user.email,createdAt:user.created_at,plan:user.plan,profile:profileByUser.get(user.id)||{display_name:'',profession:'',bio:''},workspace:workspaceByUser.get(user.id)||null});
  function validate(email,password){
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)throw Object.assign(new Error('Enter a valid email address.'),{status:422});
    if(typeof password!=='string'||password.length<12||password.length>128)throw Object.assign(new Error('Use a password between 12 and 128 characters.'),{status:422});
  }
  async function hashPassword(password){const salt=randomBytes(16);const hash=await scrypt(password,salt,64);return `${salt.toString('hex')}:${hash.toString('hex')}`;}
  async function verifyPassword(password,stored){const [salt,expected]=stored.split(':');const actual=await scrypt(password,Buffer.from(salt,'hex'),64);return timingSafeEqual(actual,Buffer.from(expected,'hex'));}
  function startSession(user){const token=randomBytes(32).toString('base64url');insertSession.run(tokenHash(token),user.id,Date.now()+SESSION_SECONDS*1000);return {token,user:publicUser(user)};}
  return {
    sessionSeconds:SESSION_SECONDS,
    async register(rawEmail,password){
      const email=normalizeEmail(rawEmail);validate(email,password);
      const passwordHash=await hashPassword(password);
      const user={id:randomUUID(),email,password_hash:passwordHash,created_at:new Date().toISOString(),plan:'free'};
      if(byEmail.get(email))throw Object.assign(new Error('An account with this email already exists.'),{status:409});
      const workspaceId=randomUUID();
      db.exec('BEGIN IMMEDIATE');
      try{
        insertUser.run(user.id,user.email,user.password_hash,user.created_at);
        db.prepare('INSERT INTO profiles (user_id,updated_at) VALUES (?,?)').run(user.id,user.created_at);
        db.prepare('INSERT INTO workspaces (id,owner_id,name,type,created_at) VALUES (?,?,?,?,?)').run(workspaceId,user.id,'Personal workspace','personal',user.created_at);
        db.prepare('INSERT INTO workspace_members (workspace_id,user_id,role) VALUES (?,?,?)').run(workspaceId,user.id,'owner');
        db.exec('COMMIT');
      }catch(error){db.exec('ROLLBACK');throw error;}
      return startSession(user);
    },
    async login(rawEmail,password){
      const email=normalizeEmail(rawEmail);
      const user=byEmail.get(email);
      if(!user||typeof password!=='string'||!await verifyPassword(password,user.password_hash))throw Object.assign(new Error('Email or password is incorrect.'),{status:401});
      return startSession(user);
    },
    getUser(token){if(typeof token!=='string'||token.length!==43)return null;const user=bySession.get(tokenHash(token),Date.now());return user?publicUser(user):null;},
    updateProfile(token,input){
      const user=this.getUser(token);if(!user)throw Object.assign(new Error('Sign in to continue.'),{status:401});
      if(!input||typeof input!=='object')throw Object.assign(new Error('Invalid profile details.'),{status:422});
      const fields=['displayName','profession','bio'].map(key=>input[key]);
      if(fields.some(value=>typeof value!=='string')||fields[0].trim().length>80||fields[1].trim().length>80||fields[2].trim().length>320)throw Object.assign(new Error('Profile details are too long.'),{status:422});
      db.prepare('UPDATE profiles SET display_name=?,profession=?,bio=?,updated_at=? WHERE user_id=?').run(...fields.map(value=>value.trim()),new Date().toISOString(),user.id);
      return this.getUser(token);
    },
    logout(token){if(typeof token==='string')db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token));},
    async deleteAccount(token,password){
      const user=this.getUser(token);if(!user)throw Object.assign(new Error('Sign in to continue.'),{status:401});
      const record=byEmail.get(user.email);
      if(typeof password!=='string'||!await verifyPassword(password,record.password_hash))throw Object.assign(new Error('Password is incorrect.'),{status:401});
      db.prepare('DELETE FROM users WHERE id=?').run(user.id);
    },
    close(){db.close();}
  };
}
