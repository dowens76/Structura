-- Backup of legacy clause_relationships table, dropped 2026-08-12.
-- Superseded by rst_relations (the current 'Clause relationships' feature).
-- No code referenced this table; 24 stale rows from Mar 2026 dev/test data.
-- To restore: sqlite3 data/user.db < this_file.sql

CREATE TABLE `clause_relationships` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`from_seg_word_id` text NOT NULL,
	`to_seg_word_id` text NOT NULL,
	`rel_type` text NOT NULL,
	`text_source` text NOT NULL,
	`book` text NOT NULL,
	`chapter` integer NOT NULL,
	`created_at` text
, workspace_id INTEGER NOT NULL DEFAULT 1
          REFERENCES workspaces(id) ON DELETE CASCADE, intersect_point TEXT NOT NULL DEFAULT 'mid');
CREATE INDEX `clrel_book_ch_src_idx` ON `clause_relationships` (`book`,`chapter`,`text_source`);

INSERT INTO clause_relationships VALUES(10,'GNT.61.1.1.1','GNT.61.1.3.1','coordination','SBLGNT','Matt',1,'2026-03-08T00:00:02.006Z',1,'mid');
INSERT INTO clause_relationships VALUES(14,'GNT.64.3.16.14','GNT.64.3.16.22','contrast','SBLGNT','John',3,'2026-03-09T15:43:10.341Z',1,'mid');
INSERT INTO clause_relationships VALUES(15,'GNT.64.3.16.22','GNT.64.3.16.8','purpose','SBLGNT','John',3,'2026-03-09T15:43:50.354Z',1,'mid');
INSERT INTO clause_relationships VALUES(29,'09794','09Wkf','purpose','OSHB','1Sam',1,'2026-03-17T18:56:24.718Z',1,'mid');
INSERT INTO clause_relationships VALUES(30,'09794','09kfX','purpose','OSHB','1Sam',1,'2026-03-17T18:56:30.408Z',1,'mid');
INSERT INTO clause_relationships VALUES(31,'01xeN','01LN3','cause','OSHB','Gen',1,'2026-03-17T19:41:54.995Z',1,'mid');
INSERT INTO clause_relationships VALUES(33,'19xeN','19vuQ','content','OSHB','Ps',1,'2026-03-17T21:36:37.140Z',1,'mid');
INSERT INTO clause_relationships VALUES(34,'19xeN','19LN3','content','OSHB','Ps',1,'2026-03-17T21:36:48.466Z',1,'mid');
INSERT INTO clause_relationships VALUES(36,'19W26','19GzE','content','OSHB','Ps',1,'2026-03-17T21:37:51.016Z',1,'mid');
INSERT INTO clause_relationships VALUES(37,'19W26','19794','content','OSHB','Ps',1,'2026-03-17T21:37:55.202Z',1,'mid');
INSERT INTO clause_relationships VALUES(39,'195gQ','19FV9','contrast','OSHB','Ps',1,'2026-03-17T21:38:24.891Z',1,'mid');
INSERT INTO clause_relationships VALUES(40,'0911V','09JY8','purpose','OSHB','1Sam',23,'2026-03-18T14:31:17.739Z',1,'mid');
INSERT INTO clause_relationships VALUES(41,'09Dxs','09G7M','purpose','OSHB','1Sam',23,'2026-03-18T14:31:32.186Z',1,'mid');
INSERT INTO clause_relationships VALUES(42,'09Dxs','09DKw','purpose','OSHB','1Sam',23,'2026-03-18T14:31:36.221Z',1,'mid');
INSERT INTO clause_relationships VALUES(44,'09gPK','095KR','condition','OSHB','1Sam',23,'2026-03-18T14:32:29.228Z',1,'mid');
INSERT INTO clause_relationships VALUES(45,'09nts','09jRn','temporal','OSHB','1Sam',23,'2026-03-18T14:34:01.523Z',1,'mid');
INSERT INTO clause_relationships VALUES(62,'GNT.61.1.1.1','GNT.61.1.3.1','coordination','SBLGNT','Matt',1,'2026-03-18T17:22:51.782Z',1,'mid');
INSERT INTO clause_relationships VALUES(63,'GNT.61.1.1.1','GNT.61.1.3.1','coordination','SBLGNT','Matt',1,'2026-03-18T17:23:42.536Z',1,'mid');
INSERT INTO clause_relationships VALUES(64,'GNT.61.1.1.1','GNT.61.1.5.1','coordination','SBLGNT','Matt',1,'2026-03-18T17:25:07.363Z',1,'mid');
INSERT INTO clause_relationships VALUES(65,'GNT.69.6.12.1','GNT.69.6.12.10','purpose','SBLGNT','Gal',6,'2026-03-18T17:58:08.461Z',1,'mid');
INSERT INTO clause_relationships VALUES(66,'GNT.69.6.13.8','GNT.69.6.13.12','purpose','SBLGNT','Gal',6,'2026-03-18T17:59:20.586Z',1,'mid');
INSERT INTO clause_relationships VALUES(68,'GNT.69.6.16.1','GNT.69.6.16.7','content','SBLGNT','Gal',6,'2026-03-18T18:00:12.929Z',1,'mid');
INSERT INTO clause_relationships VALUES(69,'GNT.69.6.16.1','GNT.69.6.16.12','content','SBLGNT','Gal',6,'2026-03-18T18:00:17.887Z',1,'mid');
INSERT INTO clause_relationships VALUES(70,'GNT.69.6.17.1','GNT.69.6.17.7','cause','SBLGNT','Gal',6,'2026-03-18T18:00:40.764Z',1,'mid');
