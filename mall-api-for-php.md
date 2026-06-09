# 眠加商城积分API接口文档（PHP端）

## 概述
乐伴好眠App需要与现有uni-app商城的积分系统打通，商城端需要提供以下API接口。

## 接口规范

### 基础URL
```
https://your-mall-domain.com/api
```

### 签名算法
所有请求都需要签名验证：
1. 将所有参数按key字典序排序
2. 拼接成 `key1=value1&key2=value2` 格式
3. 末尾拼接 `appSecret`
4. MD5加密，得到签名

```php
function generateSign($params, $appSecret) {
    ksort($params);
    $string = http_build_query($params);
    return md5($string . $appSecret);
}
```

### 通用返回格式
```json
{
    "code": 0,      // 0成功，其他失败
    "message": "",  // 错误信息
    "data": {}      // 返回数据
}
```

---

## 接口列表

### 1. 获取用户积分

**请求**
```
GET /api/points/get
```

**参数**
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| appKey | string | 是 | 应用标识 |
| openid | string | 是 | 微信openid |
| timestamp | int | 是 | 时间戳 |
| sign | string | 是 | 签名 |

**响应**
```json
{
    "code": 0,
    "message": "success",
    "data": {
        "points": 1280,        // 当前可用积分
        "total_points": 5000   // 累计获得积分
    }
}
```

---

### 2. 增加积分

**请求**
```
POST /api/points/add
```

**参数**
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| appKey | string | 是 | 应用标识 |
| openid | string | 是 | 微信openid |
| points | int | 是 | 积分数量 |
| type | string | 是 | 积分类型：share_music/music_played/music_liked/music_shared/post_comment/daily_sign/invite_friend/purchase |
| description | string | 否 | 积分描述 |
| timestamp | int | 是 | 时间戳 |
| sign | string | 是 | 签名 |

**响应**
```json
{
    "code": 0,
    "message": "success",
    "data": {
        "current_points": 1300,  // 增加后的积分
        "added_points": 20       // 本次增加的积分
    }
}
```

---

### 3. 扣除积分

**请求**
```
POST /api/points/deduct
```

**参数**
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| appKey | string | 是 | 应用标识 |
| openid | string | 是 | 微信openid |
| points | int | 是 | 积分数量 |
| type | string | 是 | 消费类型：generate_music/unlock_template/exchange_coupon |
| description | string | 否 | 消费描述 |
| timestamp | int | 是 | 时间戳 |
| sign | string | 是 | 签名 |

**响应**
```json
{
    "code": 0,
    "message": "success",
    "data": {
        "current_points": 1250,   // 扣除后的积分
        "deducted_points": 30     // 本次扣除的积分
    }
}
```

**错误码**
- `4001` - 积分不足

---

### 4. 获取积分记录

**请求**
```
GET /api/points/history
```

**参数**
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| appKey | string | 是 | 应用标识 |
| openid | string | 是 | 微信openid |
| page | int | 否 | 页码，默认1 |
| limit | int | 否 | 每页数量，默认20 |
| timestamp | int | 是 | 时间戳 |
| sign | string | 是 | 签名 |

**响应**
```json
{
    "code": 0,
    "message": "success",
    "data": {
        "total": 100,
        "list": [
            {
                "id": 1,
                "type": "share_music",
                "points": 20,
                "action": "earn",
                "description": "首次分享音乐",
                "created_at": "2024-01-15 10:30:00"
            },
            {
                "id": 2,
                "type": "generate_music",
                "points": 30,
                "action": "spend",
                "description": "AI生成音乐",
                "created_at": "2024-01-15 11:00:00"
            }
        ]
    }
}
```

---

## 数据库表结构建议

如果商城还没有积分记录表，建议添加：

```sql
-- 用户积分表（如不存在）
CREATE TABLE IF NOT EXISTS `user_points` (
    `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
    `openid` varchar(100) NOT NULL COMMENT '微信openid',
    `points` int(11) NOT NULL DEFAULT '0' COMMENT '当前积分',
    `total_points` int(11) NOT NULL DEFAULT '0' COMMENT '累计积分',
    `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `openid` (`openid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户积分表';

-- 积分记录表
CREATE TABLE IF NOT EXISTS `points_log` (
    `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
    `openid` varchar(100) NOT NULL COMMENT '微信openid',
    `type` varchar(50) NOT NULL COMMENT '积分类型',
    `points` int(11) NOT NULL COMMENT '积分数量',
    `action` enum('earn','spend') NOT NULL COMMENT '动作：获得/消耗',
    `description` varchar(255) DEFAULT NULL COMMENT '描述',
    `source` varchar(50) DEFAULT 'sleep_app' COMMENT '来源：sleep_app/mall',
    `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `openid` (`openid`),
    KEY `type` (`type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='积分记录表';
```

---

## 配置信息

### 需要提供给乐伴好眠的配置：
```
MALL_API_URL=https://your-mall-domain.com/api
MALL_APP_KEY=your-app-key
MALL_APP_SECRET=your-app-secret
```

### PHP端示例代码

```php
<?php
class PointsController {
    private $appKey = 'your-app-key';
    private $appSecret = 'your-app-secret';
    
    // 验证签名
    private function verifySign($params) {
        $sign = $params['sign'];
        unset($params['sign']);
        
        ksort($params);
        $string = http_build_query($params);
        $calcSign = md5($string . $this->appSecret);
        
        return $sign === $calcSign;
    }
    
    // 获取用户积分
    public function get() {
        $params = $_GET;
        
        if (!$this->verifySign($params)) {
            return json(['code' => 4000, 'message' => '签名错误']);
        }
        
        $openid = $params['openid'];
        $points = Db::table('user_points')->where('openid', $openid)->find();
        
        return json([
            'code' => 0,
            'data' => [
                'points' => $points ? $points['points'] : 0,
                'total_points' => $points ? $points['total_points'] : 0
            ]
        ]);
    }
    
    // 增加积分
    public function add() {
        $params = $_POST;
        
        if (!$this->verifySign($params)) {
            return json(['code' => 4000, 'message' => '签名错误']);
        }
        
        $openid = $params['openid'];
        $points = (int)$params['points'];
        $type = $params['type'];
        $description = $params['description'] ?? '';
        
        // 开启事务
        Db::startTrans();
        try {
            // 更新用户积分
            $userPoints = Db::table('user_points')->where('openid', $openid)->find();
            if ($userPoints) {
                Db::table('user_points')->where('openid', $openid)->update([
                    'points' => $userPoints['points'] + $points,
                    'total_points' => $userPoints['total_points'] + $points
                ]);
            } else {
                Db::table('user_points')->insert([
                    'openid' => $openid,
                    'points' => $points,
                    'total_points' => $points
                ]);
            }
            
            // 记录日志
            Db::table('points_log')->insert([
                'openid' => $openid,
                'type' => $type,
                'points' => $points,
                'action' => 'earn',
                'description' => $description,
                'source' => 'sleep_app'
            ]);
            
            Db::commit();
            
            $currentPoints = Db::table('user_points')->where('openid', $openid)->value('points');
            
            return json([
                'code' => 0,
                'data' => [
                    'current_points' => $currentPoints,
                    'added_points' => $points
                ]
            ]);
        } catch (Exception $e) {
            Db::rollback();
            return json(['code' => 500, 'message' => '操作失败']);
        }
    }
    
    // 扣除积分
    public function deduct() {
        $params = $_POST;
        
        if (!$this->verifySign($params)) {
            return json(['code' => 4000, 'message' => '签名错误']);
        }
        
        $openid = $params['openid'];
        $points = (int)$params['points'];
        $type = $params['type'];
        $description = $params['description'] ?? '';
        
        $userPoints = Db::table('user_points')->where('openid', $openid)->find();
        
        if (!$userPoints || $userPoints['points'] < $points) {
            return json(['code' => 4001, 'message' => '积分不足']);
        }
        
        Db::startTrans();
        try {
            Db::table('user_points')->where('openid', $openid)->update([
                'points' => $userPoints['points'] - $points
            ]);
            
            Db::table('points_log')->insert([
                'openid' => $openid,
                'type' => $type,
                'points' => $points,
                'action' => 'spend',
                'description' => $description,
                'source' => 'sleep_app'
            ]);
            
            Db::commit();
            
            return json([
                'code' => 0,
                'data' => [
                    'current_points' => $userPoints['points'] - $points,
                    'deducted_points' => $points
                ]
            ]);
        } catch (Exception $e) {
            Db::rollback();
            return json(['code' => 500, 'message' => '操作失败']);
        }
    }
    
    // 获取积分记录
    public function history() {
        $params = $_GET;
        
        if (!$this->verifySign($params)) {
            return json(['code' => 4000, 'message' => '签名错误']);
        }
        
        $openid = $params['openid'];
        $page = (int)($params['page'] ?? 1);
        $limit = (int)($params['limit'] ?? 20);
        $offset = ($page - 1) * $limit;
        
        $total = Db::table('points_log')->where('openid', $openid)->count();
        $list = Db::table('points_log')
            ->where('openid', $openid)
            ->order('id', 'desc')
            ->limit($offset, $limit)
            ->select();
        
        return json([
            'code' => 0,
            'data' => [
                'total' => $total,
                'list' => $list
            ]
        ]);
    }
}
```

---

## 注意事项

1. **安全性**：务必验证签名，防止恶意调用
2. **幂等性**：增加/扣除积分接口应该支持幂等（通过添加唯一请求ID）
3. **事务处理**：积分操作必须使用数据库事务
4. **日志记录**：所有积分变动都要记录到points_log表
5. **异常处理**：积分不足时返回4001错误码
